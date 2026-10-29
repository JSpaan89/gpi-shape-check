(function () {
  'use strict';
  var VERSION = 'v0.3.0';
  var RELEASE_NOTES = [
    ['v0.3.0', ['Measure tab: 4 to 8 side photos of a head or cone give the profile, diameters and out of roundness, checked against DIN 28011, DIN 28013 or a cone.', 'Scale from a tape circumference, a ruler next to the part, or none (shape only).', '3D view coloured by deviation, and exports: PLY for Blender with colours, STEP solid, STL, STEP points, CSV.', 'Fixed: diameter read a few mm too small on sparse scans.']],
    ['v0.2.0', ['Edge test: take a photo of a part and see whether the steel outline is found.', 'Drag a box on the photo to limit the search.', 'Test log with CSV download to compare backgrounds and finishes.', 'Installable as an app on the phone.']]
  ];
  var MAX_SIDE = 4096;            // longest photo side processed, keeps a 12 MP photo at full detail
  var MIN_DRAG_PX = 12;           // smaller drags are taps, not a search box
  var WORKER_TIMEOUT_MS = 60000;  // a stuck or killed worker must not lock the screen
  var LOG_KEY = 'gpi-shapecheck-edgelog-v1';
  var VERDICT_TEXT = { usable: 'USABLE', doubtful: 'DOUBTFUL', 'not usable': 'NOT USABLE' };
  var $ = function (id) { return document.getElementById(id); };
  // gray: one byte per pixel; job: bumped whenever photo or box changes, so late results are ignored
  var state = { bmp: null, w: 0, h: 0, gray: null, roi: null, res: null, name: '', busy: false, pending: false, job: 0, load: 0 };

  /* ---------- small helpers ---------- */
  var toastTimer;
  function toast(msg, ms) { var el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3200); }
  function setProgress(p, m) { $('pbar').style.width = Math.round(p * 100) + '%'; $('pmsg').textContent = m || ''; }
  function fmt(v, d) { return v == null || !isFinite(v) ? 'n/a' : Number(v).toFixed(d == null ? 1 : d); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function selText(id) { var el = $(id); return el.options[el.selectedIndex].text; }

  /* ---------- photo in ---------- */
  function loadBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
    return new Promise(function (resolve, reject) {
      var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = function () { reject(new Error('This photo could not be read.')); };
      img.src = URL.createObjectURL(file);
    });
  }
  function onFile(e) {
    var file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    var load = ++state.load;
    setProgress(0.05, 'Reading photo');
    loadBitmap(file).then(function (bmp) {
      if (load !== state.load) { if (bmp.close) bmp.close(); return; } // a newer photo was chosen meanwhile
      var bw = bmp.width, bh = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(bw, bh));
      var w = Math.round(bw * k), h = Math.round(bh * k), c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      state.gray = SIL.toGray(ctx.getImageData(0, 0, w, h).data, w, h, new Uint8ClampedArray(w * h));
      state.bmp = c; state.w = w; state.h = h; state.name = file.name || 'photo';
      state.roi = defaultRoi(); state.res = null; state.job++;
      $('resetRoi').disabled = false;
      $('vnote').textContent = w + ' x ' + h + ' px. Drag a box around the part to limit the search.'; $('vnote').hidden = false;
      draw(); analyze();
    }).catch(function (err) { setProgress(0, ''); toast((err && err.message) || 'This photo could not be read.', 5000); });
  }
  function defaultRoi() { var mx = Math.round(state.w * 0.02), my = Math.round(state.h * 0.02); return { x0: mx, y0: my, x1: state.w - 1 - mx, y1: state.h - 1 - my }; }

  /* ---------- edge search ---------- */
  var worker = null;
  function getWorker() {
    if (worker === null) { try { worker = new Worker('src/edge-worker.js'); } catch (e) { worker = false; } }
    return worker;
  }
  function searchHere(msg) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { try { resolve(SIL.analyzeImage(msg.gray, msg.w, msg.h, msg.opts)); } catch (e) { reject(e); } }, 20);
    });
  }
  // The worker gets a structured-clone copy of the gray image, so the main thread can still fall back on it.
  function runSearch(msg) {
    var w = getWorker();
    if (!w) return searchHere(msg);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { w.terminate(); worker = null; reject(new Error('The edge search took too long. Drag a smaller box and try again.')); }, WORKER_TIMEOUT_MS);
      w.onmessage = function (e) { clearTimeout(timer); if (e.data.ok) resolve(e.data.res); else reject(new Error(e.data.msg)); };
      w.onerror = function (err) {
        clearTimeout(timer); if (err.preventDefault) err.preventDefault();
        w.terminate(); worker = false; searchHere(msg).then(resolve, reject);
      };
      w.postMessage(msg);
    });
  }
  function analyze() {
    if (!state.gray) return;
    if (state.busy) { state.pending = true; return; }
    state.busy = true; state.pending = false; $('addLog').disabled = true;
    var job = state.job;
    setProgress(0.3, 'Searching the outline');
    runSearch({ gray: state.gray, w: state.w, h: state.h, opts: { roi: state.roi } }).then(function (res) {
      if (job !== state.job) return; // photo or box changed meanwhile
      state.res = res; renderResult(); draw(); setProgress(1, 'Outline searched');
      $('vnote').hidden = true;
      $('addLog').disabled = false;
    }).catch(function (err) {
      setProgress(0, ''); toast((err && err.message) || 'Edge search failed.', 6000);
    }).then(function () { state.busy = false; if (state.pending) analyze(); });
  }

  /* ---------- result ---------- */
  function mmPerPx(s) { var da = +$('da').value; return da > 0 && s.baseWidthPx ? da / s.baseWidthPx : null; }
  function renderResult() {
    var s = state.res.summary, k = mmPerPx(s), v = s.verdict, h = [];
    var why = v === 'usable' ? 'The outline is found along the whole part with little scatter.'
      : v === 'doubtful' ? 'The outline is found, but with gaps or scatter. Try another background or light.'
      : 'The outline is not found reliably on this photo.';
    h.push('<div class="verdict ' + v.replace(' ', '') + '"><div class="big">' + VERDICT_TEXT[v] + '</div><div class="sub">' + why + '</div></div>');
    var rows = [
      ['Side edges found', fmt(s.sides.coverage * 100, 0) + '%'],
      ['Side edge scatter (1 sigma)', fmt(s.sides.sigma, 2) + ' px' + (k ? ' = ' + fmt(s.sides.sigma * k, 2) + ' mm' : '')],
      ['Stray side points', String(s.sides.outliers)],
      ['Top edge found', fmt(s.top.coverage * 100, 0) + '%'],
      ['Top edge scatter (1 sigma)', fmt(s.top.sigma, 2) + ' px' + (k ? ' = ' + fmt(s.top.sigma * k, 2) + ' mm' : '')],
      ['Edge contrast (x background noise)', fmt(s.contrast, 0)],
      ['Width at bottom of box', fmt(s.baseWidthPx, 1) + ' px'],
      ['Scale', k ? fmt(k, 3) + ' mm per px (from Da)' : 'Enter Da to see mm']
    ];
    h.push('<table class="st">' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>');
    h.push('<p class="hint">Scatter in mm is a first estimate from the photo scale. It ignores lens distortion and perspective; those come in the next step with calibration.</p>');
    $('result').innerHTML = h.join('');
  }

  /* ---------- drawing ---------- */
  // Pixel i covers [i, i+1) on screen, so its centre (where edge positions are measured) is at i + 0.5.
  var view = { s: 1, ox: 0, oy: 0 };
  function dots(ctx, pts, color, size) {
    ctx.fillStyle = color;
    pts.forEach(function (p) { ctx.fillRect(view.ox + (p.x + 0.5) * view.s - size / 2, view.oy + (p.y + 0.5) * view.s - size / 2, size, size); });
  }
  function draw() {
    var cv = $('cv'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!state.bmp) return;
    var s = Math.min(W / state.w, H / state.h); view = { s: s, ox: (W - state.w * s) / 2, oy: (H - state.h * s) / 2 };
    ctx.drawImage(state.bmp, view.ox, view.oy, state.w * s, state.h * s);
    var r = state.roi;
    if (r) { ctx.strokeStyle = '#2B59C3'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(view.ox + r.x0 * s, view.oy + r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s); ctx.setLineDash([]); }
    if (!state.res) return;
    dots(ctx, state.res.left.concat(state.res.right), '#00B3A0', 2.5);
    dots(ctx, state.res.top, '#F2A33A', 2.5);
  }
  function toImage(ev) {
    var b = $('cv').getBoundingClientRect();
    return { x: (ev.clientX - b.left - view.ox) / view.s - 0.5, y: (ev.clientY - b.top - view.oy) / view.s - 0.5 };
  }
  var drag = null;
  $('cv').addEventListener('pointerdown', function (ev) {
    if (!state.bmp) return;
    $('cv').setPointerCapture(ev.pointerId);
    drag = { a: toImage(ev), sx: ev.clientX, sy: ev.clientY, prev: state.roi };
  });
  $('cv').addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var b = toImage(ev);
    state.roi = SIL.clampRoi({ x0: drag.a.x, y0: drag.a.y, x1: b.x, y1: b.y }, state.w, state.h); draw();
  });
  function endDrag(ev) {
    if (!drag) return;
    var moved = ev.type === 'pointerup' && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) >= MIN_DRAG_PX;
    if (!moved) state.roi = drag.prev; // a tap or a cancelled gesture keeps the old box
    drag = null; draw();
    if (moved) { state.job++; analyze(); }
  }
  $('cv').addEventListener('pointerup', endDrag);
  $('cv').addEventListener('pointercancel', endDrag);
  $('resetRoi').addEventListener('click', function () { if (!state.bmp) return; state.roi = defaultRoi(); state.job++; draw(); analyze(); });

  /* ---------- test log ---------- */
  function readLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { return []; } }
  function writeLog(list) { try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); return true; } catch (e) { toast('The log could not be saved on this phone.'); return false; } }
  var LOG_COLS = [['date', 'Date'], ['background', 'Background'], ['stage', 'Stage'], ['finish', 'Finish'], ['verdict', 'Verdict'], ['coverage', 'Sides %'], ['sigmaPx', 'Scatter px'], ['contrast', 'Contrast'], ['mmPerPx', 'mm/px'], ['notes', 'Notes']];
  function renderLog() {
    var list = readLog();
    if (!list.length) { $('log').innerHTML = '<p class="empty">No tests logged yet.</p>'; return; }
    $('log').innerHTML = '<table class="log"><tr>' + LOG_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr>' +
      list.slice().reverse().map(function (e) { return '<tr>' + LOG_COLS.map(function (c) { return '<td>' + esc(c[0] === 'date' ? String(e.date || '').slice(0, 16).replace('T', ' ') : e[c[0]] == null ? '' : e[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  }
  $('addLog').addEventListener('click', function () {
    if (!state.res) return;
    var s = state.res.summary, k = mmPerPx(s);
    var entry = {
      date: new Date().toISOString(), background: selText('bg'), stage: selText('stage'), finish: selText('finish'), verdict: s.verdict,
      coverage: Math.round(s.sides.coverage * 100), sigmaPx: s.sides.sigma == null ? null : +s.sides.sigma.toFixed(2),
      contrast: Math.round(s.contrast), mmPerPx: k ? +k.toFixed(3) : null, photo: state.name, notes: $('notes').value.trim()
    };
    if (writeLog(readLog().concat([entry]))) { renderLog(); toast('Added to the test log'); }
  });
  function csvCell(v) {
    if (typeof v === 'number') return String(v).replace('.', ',');
    v = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // text must never run as an Excel formula
    return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  $('csvLog').addEventListener('click', function () {
    var list = readLog();
    if (!list.length) { toast('The log is empty.'); return; }
    var cols = LOG_COLS.map(function (c) { return c[0]; }).concat(['photo']);
    var csv = [cols.join(';')].concat(list.map(function (e) { return cols.map(function (c) { return csvCell(e[c]); }).join(';'); })).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'shapecheck_edgetest_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  });
  var clearArmed = false;
  $('clearLog').addEventListener('click', function () {
    if (!clearArmed) { clearArmed = true; $('clearLog').textContent = 'Tap again to clear'; setTimeout(function () { clearArmed = false; $('clearLog').textContent = 'Clear log'; }, 3000); return; }
    clearArmed = false; $('clearLog').textContent = 'Clear log';
    if (writeLog([])) renderLog();
  });

  /* ---------- release notes, install ---------- */
  $('ver').textContent = VERSION;
  $('ver').addEventListener('click', function () {
    $('notesBody').innerHTML = RELEASE_NOTES.map(function (r) { return '<b>' + r[0] + '</b><ul>' + r[1].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'; }).join('');
    $('notesDlg').showModal();
  });
  $('notesClose').addEventListener('click', function () { $('notesDlg').close(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* app still works online */ }); });
  }

  window.SCApp = { toast: toast }; // shared with the measure screen
  $('cam').addEventListener('change', onFile);
  $('gal').addEventListener('change', onFile);
  $('da').addEventListener('input', function () { if (state.res) renderResult(); });
  if (window.ResizeObserver) new ResizeObserver(draw).observe($('cv')); else window.addEventListener('resize', draw);
  renderLog(); draw();
})();
