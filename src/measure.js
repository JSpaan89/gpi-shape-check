/* Measure screen: part data, 4 to 8 side photos spread over half a turn,
   scale from tape circumference, ruler or none, checks by core.js, 3D view, exports. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var toast = window.SCApp.toast;
  var MAX_SIDE = 4096;       // photo side used for the edge search
  var VIEW_SIDE = 1600;      // photo side kept for display
  var MAX_PHOTOS = 8;
  var TOL = { profile: 3, diameter: 4, ovality: 8, height: 5, crownPct: 5, knucklePct: 10, slopeDeg: 1 };
  var LS = 'gpi-shapecheck-measure-v1';
  var FIELDS = ['mType', 'mDa', 'mS', 'mH1', 'mRef', 'mR', 'mBeta', 'mDtop', 'mCirc', 'mRuler', 'mTol', 'mPart'];
  var photos = [];           // {name, w, h, view, k, edges, verdict, mmPerPx, ruler}
  var result = null, current = -1, taps = null, busy = false;

  /* ---------- part form ---------- */
  function num(id) { var v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : 0; }
  function spec() {
    var t = $('mType').value, s = { type: t, Da: num('mDa'), s: num('mS'), h1: num('mH1'), ref: $('mRef').value };
    if (t === 'cone') { s.r = num('mR'); s.beta = num('mBeta'); s.dTop = num('mDtop'); }
    return s;
  }
  function tol() { return Object.assign({}, TOL, { profile: num('mTol') || TOL.profile }); }
  function syncForm() {
    var cone = $('mType').value === 'cone';
    document.querySelectorAll('.m-cone').forEach(function (el) { el.hidden = !cone; });
    try { var o = {}; FIELDS.forEach(function (k) { o[k] = $(k).value; }); localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* storage unavailable */ }
    var m = SC.buildModel(spec());
    $('mNom').textContent = m ? 'Nominal height above tangent line ' + m.H.toFixed(1) + ' mm.' : 'These dimensions do not form a valid shape.';
  }
  function loadForm() {
    try { var o = JSON.parse(localStorage.getItem(LS) || '{}') || {}; FIELDS.forEach(function (k) { if (o[k] != null && o[k] !== '') $(k).value = o[k]; }); } catch (e) { /* first use */ }
  }

  /* ---------- photos ---------- */
  var worker = null;
  function searchEdges(gray, w, h) {
    var roi = { x0: Math.round(w * 0.02), y0: Math.round(h * 0.02), x1: w - 1 - Math.round(w * 0.02), y1: h - 1 - Math.round(h * 0.02) };
    if (!worker) { try { worker = new Worker('src/edge-worker.js'); } catch (e) { worker = false; } }
    if (!worker) return Promise.resolve(SIL.analyzeImage(gray, w, h, { roi: roi }));
    return new Promise(function (resolve, reject) {
      worker.onmessage = function (e) { if (e.data.ok) resolve(e.data.res); else reject(new Error(e.data.msg)); };
      worker.onerror = function (err) { if (err.preventDefault) err.preventDefault(); worker.terminate(); worker = false; resolve(SIL.analyzeImage(gray, w, h, { roi: roi })); };
      worker.postMessage({ gray: gray, w: w, h: h, opts: { roi: roi } });
    });
  }
  function addPhoto(file) {
    if (photos.length >= MAX_PHOTOS) { toast('At most ' + MAX_PHOTOS + ' photos.'); return Promise.resolve(); }
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      var k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
      var gray = SIL.toGray(ctx.getImageData(0, 0, w, h).data, w, h, new Uint8ClampedArray(w * h));
      var kv = Math.min(1, VIEW_SIDE / Math.max(w, h)), view = document.createElement('canvas');
      view.width = Math.round(w * kv); view.height = Math.round(h * kv); view.getContext('2d').drawImage(bmp, 0, 0, view.width, view.height);
      if (bmp.close) bmp.close();
      var p = { name: file.name || 'photo', w: w, h: h, view: view, edges: null, verdict: 'searching', mmPerPx: null, ruler: null };
      photos.push(p); current = photos.length - 1; taps = null; clearResult(); renderPhotos(); showPhoto();
      return searchEdges(gray, w, h).then(function (edges) { p.edges = edges; p.verdict = edges.summary.verdict; renderPhotos(); showPhoto(); },
        function (err) { // a photo without an outline must not block Measure
          var i = photos.indexOf(p); if (i >= 0) photos.splice(i, 1);
          current = Math.min(current, photos.length - 1); renderPhotos(); showPhoto(); throw err;
        });
    }).catch(function (err) { toast((err && err.message) || 'This photo could not be read.', 5000); });
  }
  // One queue for all photos: the single edge worker handles one request at a time.
  var queue = Promise.resolve();
  function onFiles(e) {
    var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    files.forEach(function (f) { queue = queue.then(function () { return addPhoto(f); }); });
  }
  function clearResult() { result = null; $('mResult').innerHTML = ''; $('mExports').hidden = true; }
  function renderPhotos() {
    var n = photos.length;
    $('mPhotos').innerHTML = n ? photos.map(function (p, i) {
      var ang = Math.round(i * 180 / n);
      var scale = p.mmPerPx ? 'ruler ' + p.mmPerPx.toFixed(3) + ' mm/px' : 'no ruler';
      return '<li' + (i === current ? ' class="on"' : '') + '><button type="button" class="pl" data-show="' + i + '"><b>Photo ' + (i + 1) + '</b> at ' + ang + '°<span>' + p.verdict + ' · ' + scale + '</span></button>' +
        '<button type="button" class="btn sm" data-ruler="' + i + '">Ruler</button><button type="button" class="btn sm" data-del="' + i + '" aria-label="Remove photo ' + (i + 1) + '">✕</button></li>';
    }).join('') : '<li class="empty">No photos yet.</li>';
    $('mRun').disabled = n < 2 || photos.some(function (p) { return !p.edges; }) || busy;
  }
  $('mPhotos').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.show) { current = +b.dataset.show; taps = null; setView('photo'); renderPhotos(); }
    else if (b.dataset.ruler) { current = +b.dataset.ruler; taps = []; setView('photo'); renderPhotos(); }
    else if (b.dataset.del) {
      var d = +b.dataset.del; photos.splice(d, 1);
      current = Math.min(d <= current && current > 0 ? current - 1 : current, photos.length - 1);
      taps = null; clearResult(); renderPhotos(); showPhoto();
    }
  });

  /* ---------- photo view with outline and ruler taps ---------- */
  // Display coordinates map to edge-search pixels 1:1 (the view canvas is only a smaller copy).
  var view = { s: 1, ox: 0, oy: 0 };
  function showPhoto() {
    var cv = $('mcv'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var p = photos[current];
    if (!p) { $('mNote').textContent = 'Add 4 photos spread over half a turn around the part (one every 45°).'; return; }
    var s = Math.min(W / p.w, H / p.h); view = { s: s, ox: (W - p.w * s) / 2, oy: (H - p.h * s) / 2 };
    ctx.drawImage(p.view, view.ox, view.oy, p.w * s, p.h * s);
    if (p.edges) {
      ctx.fillStyle = '#00B3A0';
      p.edges.left.concat(p.edges.right).forEach(function (q) { ctx.fillRect(view.ox + (q.x + 0.5) * s - 1, view.oy + (q.y + 0.5) * s - 1, 2, 2); });
      ctx.fillStyle = '#F2A33A';
      p.edges.top.forEach(function (q) { ctx.fillRect(view.ox + (q.x + 0.5) * s - 1, view.oy + (q.y + 0.5) * s - 1, 2, 2); });
    }
    var pts = taps || p.ruler || [];
    ctx.strokeStyle = '#2B59C3'; ctx.lineWidth = 2;
    pts.forEach(function (q) { ctx.beginPath(); ctx.arc(view.ox + q.x * s, view.oy + q.y * s, 6, 0, 2 * Math.PI); ctx.stroke(); });
    if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(view.ox + pts[0].x * s, view.oy + pts[0].y * s); ctx.lineTo(view.ox + pts[1].x * s, view.oy + pts[1].y * s); ctx.stroke(); }
    $('mNote').textContent = taps ? (taps.length ? 'Now tap the other end of the ruler.' : 'Tap one end of the ruler (' + (num('mRuler') || '?') + ' mm).') :
      'Photo ' + (current + 1) + ': ' + p.verdict + '. Tap Ruler to set the scale on this photo.';
  }
  $('mcv').addEventListener('click', function (ev) {
    if (!taps || !photos[current]) return;
    var b = $('mcv').getBoundingClientRect();
    taps.push({ x: (ev.clientX - b.left - view.ox) / view.s, y: (ev.clientY - b.top - view.oy) / view.s });
    if (taps.length === 2) {
      try { photos[current].mmPerPx = PRO.rulerScale(taps[0], taps[1], num('mRuler')); photos[current].ruler = taps; clearResult(); }
      catch (err) { toast(err.message, 5000); }
      taps = null; renderPhotos();
    }
    showPhoto();
  });

  /* ---------- measure ---------- */
  /* Points always reach core.js in mm with a fixed scale: a free scale fit can collapse
     on the sparse points from photos. Ruler on every photo: per-photo scale (copes with
     different distances). Otherwise one common scale, so the photos still compare.
     A tape circumference then sets the absolute size. */
  function scaledViews(ph, sp, circ) {
    var ruled = ph.every(function (p) { return p.mmPerPx > 0; });
    var views, source;
    if (ruled) { views = ph.map(function (p) { return PRO.fromEdges(p.edges, { mmPerPx: p.mmPerPx }); }); source = 'ruler'; }
    else {
      var raw = ph.map(function (p) { return PRO.fromEdges(p.edges, { mmPerPx: 1 }); });
      var k = sp.Da / (raw.reduce(function (s, v) { return s + v.baseWidthPx; }, 0) / raw.length);
      views = ph.map(function (p) { return PRO.fromEdges(p.edges, { mmPerPx: k }); }); source = 'nominal';
    }
    if (circ > 0) {
      var meanD = views.reduce(function (s, v) { return s + v.baseWidthPx * v.mmPerPx; }, 0) / views.length, f = circ / Math.PI / meanD;
      views.forEach(function (v) { v.pts.forEach(function (p) { p.rho *= f; p.z *= f; }); });
      source = 'circumference';
    }
    return { views: views, source: source };
  }
  var SCALE_TEXT = { circumference: 'tape circumference', ruler: 'ruler on each photo', nominal: 'none, shape only' };
  function measure() {
    var sp = spec(), circ = num('mCirc');
    if (!SC.buildModel(sp)) { toast('The part dimensions do not form a valid shape.'); return; }
    var ph = photos.slice(); // photos added or removed meanwhile do not change this measurement
    busy = true; renderPhotos(); $('mResult').innerHTML = '<p class="empty">Measuring...</p>';
    setTimeout(function () {
      try {
        var sv = scaledViews(ph, sp, circ);
        var out = SC.analyzeAll(PRO.toPoints(sv.views), { spec: sp, tol: tol(), scaleMode: 'scale', unitFactor: 1 });
        var res = SC.rehydrate(out.res);
        if (sv.source === 'nominal') res.checks.forEach(function (c) {
          if (c.key === 'diameter') { c.status = 'na'; c.measured = null; c.note = 'Not checked: no ruler or tape, scale taken from the nominal Da'; }
        });
        result = { res: res, solid: out.solid, scale: SCALE_TEXT[sv.source], count: ph.length };
        renderResult(); setView('3d');
      } catch (err) { $('mResult').innerHTML = ''; toast('Measuring failed: ' + ((err && err.message) || err), 6000); }
      busy = false; renderPhotos();
    }, 30);
  }
  function fmt(v, d) { return v == null || !isFinite(v) ? 'n/a' : Number(v).toFixed(d == null ? 1 : d); }
  function renderResult() {
    var r = result.res, fails = r.checks.filter(function (c) { return c.status === 'fail'; }).length;
    var h = ['<div class="verdict ' + (fails ? 'notusable' : 'usable') + '"><div class="big">' + (fails ? 'FAIL' : 'PASS') + '</div><div class="sub">' +
      fails + ' of ' + r.checks.length + ' checks failed · ' + result.count + ' photos · scale: ' + result.scale + '</div></div><table class="st">'];
    r.checks.forEach(function (c) {
      var u = c.unit === '°' ? '°' : ' ' + c.unit;
      h.push('<tr><td>' + c.label + (c.note ? '<br><span class="hint">' + c.note + '</span>' : '') + '</td><td>' + (c.measured == null ? 'n/a' : fmt(c.measured, 1) + u) +
        '<br><span class="pill ' + c.status + '">' + (c.status === 'na' ? 'n/a' : c.status) + '</span> ' + c.limit + '</td></tr>');
    });
    h.push('</table><p class="hint">Proof of concept: uncalibrated phone camera, no lens correction. Compare with a tape and template measurement before trusting a result.</p>');
    $('mResult').innerHTML = h.join('');
    $('mExports').hidden = false;
    if (V3D.init($('gl'))) V3D.show(r, result.solid); else toast('3D view unavailable: the 3D library did not load.');
  }

  /* ---------- exports ---------- */
  function save(name, data) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function baseName() { return SC.safeName($('mPart').value || 'shapecheck') + '_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''); }
  $('mExports').addEventListener('click', function (e) {
    var k = e.target.dataset && e.target.dataset.exp; if (!k || !result) return;
    var r = result.res, s = result.solid, opt = { origin: 'tangent', part: $('mPart').value, name: baseName() }, b = baseName();
    if (k === 'ply') save(b + '_blender.ply', EX3.plyColored(s, r, opt));
    else if (k === 'stp') save(b + '_solid.stp', SC.stepSolid(s, r, opt));
    else if (k === 'stl') save(b + '_solid.stl', SC.stlBinary(s, r, opt));
    else if (k === 'pts') save(b + '_points.stp', SC.stepPointCloud(r, opt));
    else if (k === 'csv') save(b + '_deviations.csv', SC.csvDeviations(r, opt));
  });

  /* ---------- view switch and tabs ---------- */
  function setView(v) {
    $('mcv').hidden = v !== 'photo'; $('gl').hidden = v !== '3d'; $('mNote').hidden = v !== 'photo';
    document.querySelectorAll('[data-mview]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mview === v ? 'true' : 'false'); });
    if (v === 'photo') showPhoto(); else if (result && V3D.init($('gl'))) V3D.fit();
  }
  document.querySelectorAll('[data-mview]').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.mview); }); });
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-tab]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      $('viewMeasure').hidden = b.dataset.tab !== 'measure'; $('viewEdge').hidden = b.dataset.tab !== 'edge';
      window.dispatchEvent(new Event('resize'));
    });
  });

  FIELDS.forEach(function (k) { $(k).addEventListener('change', syncForm); });
  $('mCam').addEventListener('change', onFiles);
  $('mGal').addEventListener('change', onFiles);
  $('mRun').addEventListener('click', measure);
  if (window.ResizeObserver) new ResizeObserver(showPhoto).observe($('mcv'));
  loadForm(); syncForm(); renderPhotos(); setView('photo');
})();
