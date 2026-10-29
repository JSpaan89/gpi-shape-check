/* Gpi Shape Check silhouette: find the outline of a part in a side photo.
   Scans every row from the left and right, and every column from the top,
   for the first edge that stands out from the background noise.
   No DOM access, so it runs in a worker and can be tested in node. */
var SIL = (function () {
  'use strict';

  var EDGE_K = 6;          // edge must be this many times the background noise
  var MIN_STEP = 6;        // ...and at least this many grey levels steep
  var CLIMB = 10;          // max px to climb from threshold crossing to the gradient peak
  var MEDIAN_WIN = 9;      // window for the scatter reference line
  var OUTLIER_PX = 3;      // edge points further off than this count as stray
  var MAX_SLOPE = 1;       // 45 degrees: hand-over between row scan and column scan
  var MIN_TOP = 0.5;       // share of the width where the top edge must be found for "usable"

  // out: optional target, e.g. a Uint8ClampedArray to keep a 12 MP photo at 12 MB
  function toGray(rgba, w, h, out) {
    var g = out || new Float32Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }

  function clampRoi(roi, w, h) {
    var r = roi || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    var x0 = Math.max(0, Math.min(r.x0, r.x1)), x1 = Math.min(w - 1, Math.max(r.x0, r.x1));
    var y0 = Math.max(0, Math.min(r.y0, r.y1)), y1 = Math.min(h - 1, Math.max(r.y0, r.y1));
    return { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) };
  }

  /* Derivative along one image line, smoothed [1 2 1] across and along the line.
     axis 'x': line is row idx; axis 'y': line is column idx. */
  function lineDerivative(g, w, h, axis, idx) {
    var n = axis === 'x' ? w : h, p = new Float32Array(n), s = new Float32Array(n), d = new Float32Array(n), i;
    var a = Math.max(0, idx - 1), b = Math.min((axis === 'x' ? h : w) - 1, idx + 1);
    for (i = 0; i < n; i++) {
      p[i] = axis === 'x'
        ? (g[a * w + i] + 2 * g[idx * w + i] + g[b * w + i]) / 4
        : (g[i * w + a] + 2 * g[i * w + idx] + g[i * w + b]) / 4;
    }
    for (i = 1; i < n - 1; i++) s[i] = (p[i - 1] + 2 * p[i] + p[i + 1]) / 4;
    s[0] = p[0]; s[n - 1] = p[n - 1];
    for (i = 2; i < n - 2; i++) d[i] = (s[i + 1] - s[i - 1]) / 2;
    return d;
  }

  // first gradient above thr walking from start towards end, refined to sub-pixel
  function findEdge(d, start, end, thr) {
    var dir = end >= start ? 1 : -1;
    for (var i = start; dir > 0 ? i <= end : i >= end; i += dir) {
      if (Math.abs(d[i]) < thr) continue;
      var m = i;
      for (var k = 0; k < CLIMB; k++) {
        var nx = m + dir;
        if (nx < 1 || nx > d.length - 2 || Math.abs(d[nx]) <= Math.abs(d[m])) break;
        m = nx;
      }
      if (m < 1 || m > d.length - 2) return null;
      var a = Math.abs(d[m - 1]), b = Math.abs(d[m]), c = Math.abs(d[m + 1]), den = a - 2 * b + c;
      var off = den < 0 ? 0.5 * (a - c) / den : 0;
      return { pos: m + Math.max(-0.5, Math.min(0.5, off)), s: b };
    }
    return null;
  }

  function percentile(arr, p) {
    if (!arr.length) return NaN;
    var a = Array.from(arr).sort(function (x, y) { return x - y; });
    var i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  // 90th percentile of the gradient in the background strips at the edge of the region
  function backgroundNoise(g, w, h, roi, axis, step) {
    var vals = [], i, k;
    if (axis === 'x') {
      var m = Math.max(3, Math.round(0.03 * (roi.x1 - roi.x0)));
      for (var y = roi.y0; y <= roi.y1; y += step) {
        var d = lineDerivative(g, w, h, 'x', y);
        for (k = 0; k < m; k++) { i = roi.x0 + 2 + k; if (i < roi.x1) vals.push(Math.abs(d[i])); i = roi.x1 - 2 - k; if (i > roi.x0) vals.push(Math.abs(d[i])); }
      }
    } else {
      var mt = Math.max(3, Math.round(0.03 * (roi.y1 - roi.y0)));
      for (var x = roi.x0; x <= roi.x1; x += step) {
        var dc = lineDerivative(g, w, h, 'y', x);
        for (k = 0; k < mt; k++) { i = roi.y0 + 2 + k; if (i < roi.y1) vals.push(Math.abs(dc[i])); }
      }
    }
    return Math.max(0.5, percentile(vals, 0.9) || 0);
  }

  /* Robust scatter of an edge.
     Sigma: from second differences of evenly spaced neighbours, which cancel
     slope and nearly all curvature; noise sigma s gives second differences with
     sigma s*sqrt(6). The median keeps single wild points out.
     Stray points: each point is predicted from its neighbours along the median
     local slope; points far from the median prediction are counted. */
  function edgeScatter(pts, key, along) {
    var n = pts.length, half = MEDIAN_WIN >> 1;
    if (n < MEDIAN_WIN) return { n: n, sigma: null, outliers: 0 };
    var d2 = [];
    for (var j = 1; j < n - 1; j++) {
      if (pts[j][along] - pts[j - 1][along] !== pts[j + 1][along] - pts[j][along]) continue;
      d2.push(Math.abs(pts[j - 1][key] - 2 * pts[j][key] + pts[j + 1][key]));
    }
    var sigma = d2.length ? 1.4826 * percentile(d2, 0.5) / Math.sqrt(6) : null;
    var res = [];
    for (var i = 0; i < n; i++) {
      var lo = Math.max(0, Math.min(i - half, n - MEDIAN_WIN)), slopes = [], preds = [], k;
      for (k = lo; k < lo + MEDIAN_WIN - 1; k++) {
        var da = pts[k + 1][along] - pts[k][along];
        if (da) slopes.push((pts[k + 1][key] - pts[k][key]) / da);
      }
      var m = slopes.length ? percentile(slopes, 0.5) : 0;
      for (k = lo; k < lo + MEDIAN_WIN; k++) if (k !== i) preds.push(pts[k][key] + m * (pts[i][along] - pts[k][along]));
      res.push(pts[i][key] - percentile(preds, 0.5));
    }
    var lim = Math.max(OUTLIER_PX, 6 * (sigma || 0));
    return { n: n, sigma: sigma, outliers: res.filter(function (r) { return Math.abs(r) > lim; }).length };
  }

  /* A row scan is only accurate where the outline is steeper than 45 degrees,
     a column scan where it is flatter. Each scan keeps its own part. */
  function keepSteep(pts, along, across) {
    return pts.filter(function (p, i) {
      var a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
      var dl = b[along] - a[along];
      return dl !== 0 && Math.abs((b[across] - a[across]) / dl) <= MAX_SLOPE;
    });
  }

  function combine(a, b) {
    var ok = [a, b].filter(function (q) { return q.sigma != null; });
    if (!ok.length) return { sigma: null, outliers: a.outliers + b.outliers };
    var ss = ok.reduce(function (s, q) { return s + q.sigma * q.sigma; }, 0);
    return { sigma: Math.sqrt(ss / ok.length), outliers: a.outliers + b.outliers };
  }

  function verdictOf(sides, top, contrast) {
    var n = Math.max(1, sides.found);
    var stray = sides.outliers / n;
    var topOk = top.coverage >= MIN_TOP && top.sigma != null && top.sigma <= 1;
    if (sides.coverage >= 0.9 && sides.sigma != null && sides.sigma <= 0.5 && contrast >= 8 && stray <= 0.05 && topOk) return 'usable';
    if (sides.coverage >= 0.7 && sides.sigma != null && sides.sigma <= 1.5) return 'doubtful';
    return 'not usable';
  }

  function summarize(r, step) {
    var left = r.left, right = r.right, top = r.top;
    var sideY = left.concat(right).map(function (p) { return p.y; });
    var y0 = sideY.length ? Math.min.apply(null, sideY) : r.roi.y1;
    var rowsSpan = Math.max(1, Math.floor((r.roi.y1 - y0) / step) + 1);
    var sq = combine(edgeScatter(left, 'x', 'y'), edgeScatter(right, 'x', 'y'));
    var sides = { found: left.length + right.length, coverage: sideY.length ? (left.length + right.length) / (2 * rowsSpan) : 0, sigma: sq.sigma, outliers: sq.outliers };

    var sideX = left.concat(right).map(function (p) { return p.x; });
    var colsSpan = sideX.length ? Math.max(1, Math.floor((Math.max.apply(null, sideX) - Math.min.apply(null, sideX)) / step) + 1) : 1;
    var inSpan = sideX.length ? top.filter(function (p) { return p.x >= Math.min.apply(null, sideX) && p.x <= Math.max.apply(null, sideX); }) : [];
    var tq = edgeScatter(inSpan, 'y', 'x');
    var topQ = { found: inSpan.length, coverage: sideX.length ? Math.min(1, inSpan.length / colsSpan) : 0, sigma: tq.sigma, outliers: tq.outliers };

    var strengths = left.concat(right).map(function (p) { return p.s; });
    var contrast = strengths.length ? percentile(strengths, 0.5) / r.noise.x : 0;

    var widths = r.widths, base = null;
    if (widths.length) {
      var yMax = widths[widths.length - 1].y, yMin = widths[0].y, cut = yMax - 0.1 * (yMax - yMin);
      base = percentile(widths.filter(function (q) { return q.y >= cut; }).map(function (q) { return q.w; }), 0.5);
    }
    return { sides: sides, top: topQ, contrast: contrast, baseWidthPx: base, verdict: verdictOf(sides, topQ, contrast) };
  }

  /* opts: {roi:{x0,y0,x1,y1}, step} -> {left:[{y,x,s}], right:[...], top:[{x,y,s}], widths, noise, threshold, summary} */
  function analyzeImage(g, w, h, opts) {
    opts = opts || {};
    var roi = clampRoi(opts.roi, w, h);
    var step = opts.step || Math.max(1, Math.round((roi.y1 - roi.y0) / 500));
    var noise = { x: backgroundNoise(g, w, h, roi, 'x', step), y: backgroundNoise(g, w, h, roi, 'y', step) };
    var thr = { x: Math.max(EDGE_K * noise.x, MIN_STEP), y: Math.max(EDGE_K * noise.y, MIN_STEP) };
    var left = [], right = [], top = [], widths = [];
    for (var y = roi.y0; y <= roi.y1; y += step) {
      var d = lineDerivative(g, w, h, 'x', y);
      var a = findEdge(d, Math.max(2, roi.x0 + 1), Math.min(w - 3, roi.x1 - 1), thr.x);
      var b = findEdge(d, Math.min(w - 3, roi.x1 - 1), Math.max(2, roi.x0 + 1), thr.x);
      if (!a || !b || b.pos - a.pos <= 2) continue;
      left.push({ y: y, x: a.pos, s: a.s }); right.push({ y: y, x: b.pos, s: b.s }); widths.push({ y: y, w: b.pos - a.pos });
    }
    for (var x = roi.x0; x <= roi.x1; x += step) {
      var dc = lineDerivative(g, w, h, 'y', x);
      var t = findEdge(dc, Math.max(2, roi.y0 + 1), Math.min(h - 3, roi.y1 - 1), thr.y);
      if (t) top.push({ x: x, y: t.pos, s: t.s });
    }
    var r = {
      roi: roi, step: step, noise: noise, threshold: thr, widths: widths,
      left: keepSteep(left, 'y', 'x'), right: keepSteep(right, 'y', 'x'), top: keepSteep(top, 'x', 'y')
    };
    r.summary = summarize(r, step);
    return r;
  }

  return { toGray: toGray, analyzeImage: analyzeImage, edgeScatter: edgeScatter, clampRoi: clampRoi };
})();
if (typeof module !== 'undefined') module.exports = SIL;
