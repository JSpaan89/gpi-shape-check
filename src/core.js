/* Gpi Shape Check core: geometry models, best-fit, checks, solid mesh, exports.
   No DOM access, so it can be tested in node. */
var SC = (function () {
  'use strict';
  var PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------- Nominal shapes (outer surface, mm) ----------------
     Frame: z axis = head axis pointing to crown, z = 0 at tangent line
     (knuckle to straight flange), flange runs to z = -h1.
     dist(rho,z) -> signed normal distance (+ = outside nominal), t = meridian
     arc length measured from crown apex / cone top. */
  function toriModel(Ro, Rc, rk, h1) {
    var a = Ro - rk, L = Rc - rk;
    if (!(rk > 0) || !(a > 0) || !(L > a)) return null;
    var zc = -Math.sqrt(L * L - a * a), phit = Math.asin(a / L);
    var tCrown = Rc * phit, tKn = tCrown + rk * (PI / 2 - phit), tEnd = tKn + h1;
    var H = zc + Rc;
    return {
      kind: 'tori', Ro: Ro, Rc: Rc, rk: rk, h1: h1, H: H, pole: true,
      tCrown: tCrown, tKn: tKn, tEnd: tEnd,
      dist: function (rho, z, out) {
        var phq = Math.atan2(rho, z - zc);
        if (phq <= phit) { out.d = Math.sqrt(rho * rho + (z - zc) * (z - zc)) - Rc; out.t = Rc * phq; }
        else if (z >= 0) {
          var dx = rho - a; out.d = Math.sqrt(dx * dx + z * z) - rk;
          out.t = tCrown + rk * (clamp(Math.atan2(dx, z), phit, PI / 2) - phit);
        } else { out.d = rho - Ro; out.t = tKn - z; }
      },
      evalAt: function (t) {
        var p;
        if (t <= tCrown) { p = t / Rc; return [Rc * Math.sin(p), zc + Rc * Math.cos(p), Math.sin(p), Math.cos(p)]; }
        if (t <= tKn) { p = phit + (t - tCrown) / rk; return [a + rk * Math.sin(p), rk * Math.cos(p), Math.sin(p), Math.cos(p)]; }
        return [Ro, -(t - tKn), 1, 0];
      }
    };
  }

  function coneModel(Ro, rk, betaDeg, rTop, h1) {
    var b = betaDeg * PI / 180, sb = Math.sin(b), cb = Math.cos(b);
    var a = Ro - rk, psit = PI / 2 - b;
    if (!(rk > 0) || !(a > 0) || !(b > 0) || b >= PI / 2) return null;
    var P1x = a + rk * Math.cos(psit), P1z = rk * Math.sin(psit);
    var Lc = (P1x - rTop) / cb;
    if (!(Lc > 0)) return null;
    var H = P1z + Lc * sb, tKn = Lc + rk * psit, tEnd = tKn + h1;
    return {
      kind: 'cone', Ro: Ro, rk: rk, beta: betaDeg, rTop: rTop, h1: h1, H: H, pole: rTop < 1e-6,
      tCrown: Lc, tKn: tKn, tEnd: tEnd,
      dist: function (rho, z, out) {
        if (z < 0) { out.d = rho - Ro; out.t = tKn - z; return; }
        var dx = rho - a, psi = Math.atan2(z, dx);
        if (dx > 0 && psi <= psit) { out.d = Math.sqrt(dx * dx + z * z) - rk; out.t = Lc + rk * (psit - psi); }
        else { var qx = rho - P1x, qz = z - P1z; out.d = qx * sb + qz * cb; out.t = Lc + (qx * cb - qz * sb); }
      },
      evalAt: function (t) {
        if (t <= Lc) { var s = t - Lc; return [P1x + s * cb, P1z - s * sb, sb, cb]; }
        if (t <= tKn) { var ps = psit - (t - Lc) / rk; return [a + rk * Math.cos(ps), rk * Math.sin(ps), Math.cos(ps), Math.sin(ps)]; }
        return [Ro, -(t - tKn), 1, 0];
      }
    };
  }

  /* spec: {type:'din28011'|'din28013'|'tori'|'cone', Da, s, h1, R, r, ref:'inside'|'outside', beta, dTop} */
  function nominalRadii(spec) {
    if (spec.type === 'din28011') return { R: spec.Da, r: 0.1 * spec.Da };
    if (spec.type === 'din28013') return { R: 0.8 * spec.Da, r: 0.154 * spec.Da };
    return { R: spec.R, r: spec.r };
  }
  function buildModel(spec, over) {
    over = over || {};
    var off = spec.ref === 'inside' ? (spec.s || 0) : 0;
    var nr = nominalRadii(spec);
    var Ro = over.Ro != null ? over.Ro : spec.Da / 2;
    if (spec.type === 'cone') {
      return coneModel(Ro, over.rk != null ? over.rk : nr.r + off, over.beta != null ? over.beta : spec.beta,
        (spec.dTop || 0) / 2, spec.h1);
    }
    return toriModel(Ro, over.Rc != null ? over.Rc : nr.R + off, over.rk != null ? over.rk : nr.r + off, spec.h1);
  }

  /* ---------------- Linear algebra helpers ---------------- */
  function jacobiEigen(A) { // symmetric 3x3 -> {vals, vecs (columns)}
    var a = [A[0].slice(), A[1].slice(), A[2].slice()], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (var sweep = 0; sweep < 50; sweep++) {
      var off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-12) break;
      for (var p = 0; p < 2; p++) for (var q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        var th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        var t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        var c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (var k = 0; k < 3; k++) { var akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (k = 0; k < 3; k++) { var apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (k = 0; k < 3; k++) { var vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [[v[0][0], v[1][0], v[2][0]], [v[0][1], v[1][1], v[2][1]], [v[0][2], v[1][2], v[2][2]]] };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function frameFromAxis(w) {
    w = norm(w); var h = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    var u = norm(cross(h, w)), v = cross(w, u); return [u, v, w];
  }
  function matMul(A, B) { var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]; return C; }
  function rotXY(rx, ry) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    var Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]], Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
    return matMul(Ry, Rx);
  }

  /* ---------------- Nelder-Mead ---------------- */
  function nelderMead(f, x0, step, iters) {
    var n = x0.length, pts = [x0.slice()], vals = [f(x0)];
    for (var i = 0; i < n; i++) { var x = x0.slice(); x[i] += step[i]; pts.push(x); vals.push(f(x)); }
    function order() { var idx = pts.map(function (_, k) { return k; }).sort(function (a, b) { return vals[a] - vals[b]; }); pts = idx.map(function (k) { return pts[k]; }); vals = idx.map(function (k) { return vals[k]; }); }
    for (var it = 0; it < iters; it++) {
      order();
      if (Math.abs(vals[n] - vals[0]) < 1e-10 * (Math.abs(vals[0]) + 1e-12)) break;
      var c = new Array(n).fill(0);
      for (i = 0; i < n; i++) for (var j = 0; j < n; j++) c[j] += pts[i][j] / n;
      var xr = c.map(function (cj, j) { return cj + (cj - pts[n][j]); }), fr = f(xr);
      if (fr < vals[0]) {
        var xe = c.map(function (cj, j) { return cj + 2 * (cj - pts[n][j]); }), fe = f(xe);
        if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
      } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else {
        var xc = c.map(function (cj, j) { return cj + 0.5 * (pts[n][j] - cj); }), fc = f(xc);
        if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
        else { for (i = 1; i <= n; i++) { pts[i] = pts[i].map(function (v, j) { return pts[0][j] + 0.5 * (v - pts[0][j]); }); vals[i] = f(pts[i]); } }
      }
    }
    order(); return { x: pts[0], f: vals[0] };
  }

  /* ---------------- Pose ---------------- */
  // P = [rx, ry, cx, cy, z0, lnk]; transform q = k * Rot*E*(p - c0) - (cx,cy,z0)
  function poseMatrix(base, P) { return matMul(rotXY(P[0], P[1]), base.E); }
  function transformAll(xyz, base, P, out) {
    var M = poseMatrix(base, P), k = Math.exp(P[5]), c = base.c0, n = xyz.length / 3;
    for (var i = 0; i < n; i++) {
      var x = xyz[3 * i] - c[0], y = xyz[3 * i + 1] - c[1], z = xyz[3 * i + 2] - c[2];
      out[3 * i] = k * (M[0][0] * x + M[0][1] * y + M[0][2] * z) - P[2];
      out[3 * i + 1] = k * (M[1][0] * x + M[1][1] * y + M[1][2] * z) - P[3];
      out[3 * i + 2] = k * (M[2][0] * x + M[2][1] * y + M[2][2] * z) - P[4];
    }
    return out;
  }
  function makeCost(sub, base, getModel, nPose, c, zmin, freeScale, scaleFixed) {
    var tmp = new Float64Array(sub.length), o = { d: 0, t: 0 }, Lfar = Math.log(10), n = sub.length / 3;
    return function (x) {
      var P = [x[0], x[1], x[2], x[3], x[4], freeScale ? x[5] : scaleFixed];
      var model = getModel(x.slice(nPose));
      if (!model) return 1e12;
      transformAll(sub, base, P, tmp);
      var s = 0;
      for (var i = 0; i < n; i++) {
        var qz = tmp[3 * i + 2];
        if (qz < zmin) { s += Lfar; continue; }
        model.dist(Math.hypot(tmp[3 * i], tmp[3 * i + 1]), qz, o);
        var u = o.d / c; s += Math.log(1 + u * u);
      }
      return s;
    };
  }

  function percentile(arr, p) { var a = Array.from(arr).sort(function (x, y) { return x - y; }); if (!a.length) return NaN; var i = clamp((a.length - 1) * p, 0, a.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }
  function median(a) { return percentile(a, 0.5); }

  function subsample(xyz, nMax, seed) {
    var n = xyz.length / 3; if (n <= nMax) return Float64Array.from(xyz);
    var out = new Float64Array(nMax * 3), r = seed || 12345;
    for (var i = 0; i < nMax; i++) { r = (r * 1103515245 + 12345) & 0x7fffffff; var k = Math.floor((r / 0x7fffffff) * n); out[3 * i] = xyz[3 * k]; out[3 * i + 1] = xyz[3 * k + 1]; out[3 * i + 2] = xyz[3 * k + 2]; }
    return out;
  }
  function autoUnit(xyz, Da) {
    var n = xyz.length / 3, mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
    for (var i = 0; i < n; i++) for (var j = 0; j < 3; j++) { var v = xyz[3 * i + j]; if (v < mn[j]) mn[j] = v; if (v > mx[j]) mx[j] = v; }
    var ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    var best = 1, bestE = 1e9;
    [1, 10, 1000, 25.4].forEach(function (f) { var e = Math.abs(Math.log(ext * f / Da)); if (e < bestE) { bestE = e; best = f; } });
    return { factor: best, extent: ext };
  }

  /* ---------------- Main analysis ----------------
     opts: {spec, tol, unitFactor, scaleMode:'scale'|'circ'|'free', circumference, extraBelow, onProgress} */
  function analyze(xyzRaw, opts, onProgress) {
    var spec = opts.spec, tol = opts.tol, prog = onProgress || function () {};
    var nom = buildModel(spec);
    if (!nom) throw new Error('These dimensions do not form a valid shape. Check diameter, radii and angle.');
    var Da = spec.Da, n = xyzRaw.length / 3;
    var unit = opts.unitFactor || autoUnit(xyzRaw, Da).factor;
    var xyz = new Float64Array(n * 3); for (var i = 0; i < 3 * n; i++) xyz[i] = xyzRaw[i] * unit;
    var zmin = -(spec.h1 + (opts.extraBelow || 0)) - 1e-6;
    var sub = subsample(xyz, 2500, 777);
    var ns = sub.length / 3, c0 = [0, 0, 0];
    for (i = 0; i < ns; i++) { c0[0] += sub[3 * i] / ns; c0[1] += sub[3 * i + 1] / ns; c0[2] += sub[3 * i + 2] / ns; }
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (i = 0; i < ns; i++) { var d = [sub[3 * i] - c0[0], sub[3 * i + 1] - c0[1], sub[3 * i + 2] - c0[2]]; for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) C[a][b] += d[a] * d[b] / ns; }
    var eig = jacobiEigen(C);
    var freeScale = opts.scaleMode !== 'scale';
    var lnk0 = 0;
    if (freeScale) { // rough scale guess from the radial spread
      var ext = autoUnit(sub, Da).extent; lnk0 = Math.log(Da / ext);
    }
    var poseModel = function () { return nom; };
    var best = null;
    prog(0.05, 'Finding the axis');
    for (var e = 0; e < 3; e++) for (var sg = -1; sg <= 1; sg += 2) {
      var w = eig.vecs[e].map(function (v) { return v * sg; });
      var base = { E: frameFromAxis(w), c0: c0 };
      var k0 = Math.exp(lnk0), hs = new Float64Array(ns);
      for (i = 0; i < ns; i++) hs[i] = k0 * (w[0] * (sub[3 * i] - c0[0]) + w[1] * (sub[3 * i + 1] - c0[1]) + w[2] * (sub[3 * i + 2] - c0[2]));
      var z0 = percentile(hs, 0.995) - nom.H;
      var x0 = [0, 0, 0, 0, z0], st = [0.08, 0.08, 0.02 * Da, 0.02 * Da, 0.03 * Da];
      if (freeScale) { x0.push(lnk0); st.push(0.1); }
      var f = makeCost(sub, base, poseModel, freeScale ? 6 : 5, 0.03 * Da, zmin, freeScale, lnk0);
      var r = nelderMead(f, x0, st, 250);
      if (!best || r.f < best.f) best = { f: r.f, x: r.x, base: base };
    }
    prog(0.35, 'Best-fit alignment');
    var stages = [0.012 * Da, 0.004 * Da, Math.max(0.8, tol.profile * 0.6)];
    var x = best.x;
    stages.forEach(function (cc, si) {
      var f = makeCost(sub, best.base, poseModel, freeScale ? 6 : 5, cc, zmin, freeScale, lnk0);
      var st = [0.01, 0.01, 0.003 * Da, 0.003 * Da, 0.003 * Da]; if (freeScale) st.push(0.01);
      x = nelderMead(f, x, st, 500).x; x = nelderMead(f, x, st.map(function (v) { return v / 4; }), 400).x;
      prog(0.35 + 0.15 * (si + 1), 'Best-fit alignment');
    });
    var lnk = freeScale ? x[5] : lnk0;
    var circNote = null;
    if (opts.scaleMode === 'circ' && opts.circumference > 0) {
      var DoMeas = opts.circumference / PI;
      lnk = lnk + Math.log(DoMeas / Da);
      var f2 = makeCost(sub, best.base, poseModel, 5, Math.max(0.8, tol.profile * 0.6), zmin, false, lnk);
      var st2 = [0.005, 0.005, 0.002 * Da, 0.002 * Da, 0.002 * Da];
      x = nelderMead(f2, x.slice(0, 5), st2, 600).x;
      circNote = DoMeas;
    }
    var pose = [x[0], x[1], x[2], x[3], x[4], lnk];

    // Shape fit (actual dimensions), pose + shape free, scale fixed
    prog(0.85, 'Measuring actual dimensions');
    var shapeX0, shapeSt, shapeModel;
    if (nom.kind === 'tori') {
      shapeX0 = [nom.Ro, nom.Rc, nom.rk]; shapeSt = [0.005 * Da, 0.03 * nom.Rc, 0.1 * nom.rk];
      shapeModel = function (s) { return toriModel(s[0], s[1], s[2], spec.h1); };
    } else {
      shapeX0 = [nom.Ro, nom.beta, nom.rk]; shapeSt = [0.005 * Da, 0.5, 0.1 * nom.rk];
      shapeModel = function (s) { return coneModel(s[0], s[2], s[1], nom.rTop, spec.h1); };
    }
    var fS = makeCost(sub, best.base, shapeModel, 5, Math.max(0.8, tol.profile * 0.6), zmin, false, lnk);
    var xs0 = pose.slice(0, 5).concat(shapeX0), sts = [0.003, 0.003, 0.001 * Da, 0.001 * Da, 0.001 * Da].concat(shapeSt);
    var rs = nelderMead(fS, xs0, sts, 900); rs = nelderMead(fS, rs.x, sts.map(function (v) { return v / 5; }), 700);
    var actual = shapeModel(rs.x.slice(5)) || nom;

    // Deviations for all points against nominal
    prog(0.95, 'Computing deviations');
    var q = transformAll(xyz, best.base, pose, new Float64Array(n * 3));
    var dev = new Float32Array(n), tpar = new Float32Array(n), inReg = new Uint8Array(n), o = { d: 0, t: 0 };
    var devIn = [];
    for (i = 0; i < n; i++) {
      var rho = Math.hypot(q[3 * i], q[3 * i + 1]), qz = q[3 * i + 2];
      nom.dist(rho, qz, o); dev[i] = o.d; tpar[i] = o.t;
      inReg[i] = qz >= zmin ? 1 : 0;
      if (inReg[i]) devIn.push(o.d);
    }
    // Robust outlier rejection for statistics: drop points further than 8x tolerance (scan spikes)
    var outlierLim = Math.max(8 * tol.profile, 15), kept = devIn.filter(function (v) { return Math.abs(v) <= outlierLim; });
    var nOut = devIn.length - kept.length;
    var mean = kept.reduce(function (s, v) { return s + v; }, 0) / (kept.length || 1);
    var sd = Math.sqrt(kept.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (kept.length || 1));
    var absK = kept.map(Math.abs);
    var stats = {
      n: n, nIn: devIn.length, nOutliers: nOut, mean: mean, sd: sd,
      p01: percentile(kept, 0.01), p99: percentile(kept, 0.99), min: Math.min.apply(null, kept.length ? kept.slice(0, 200000) : [0]),
      max: Math.max.apply(null, kept.length ? kept.slice(0, 200000) : [0]),
      abs99: percentile(absK, 0.99),
      pctIn: kept.filter(function (v) { return Math.abs(v) <= tol.profile; }).length / (kept.length || 1) * 100
    };
    // Roundness and diameter from the band at/below the tangent line
    var bins = 36, band = [];
    for (i = 0; i < bins; i++) band.push([]);
    var lo = spec.h1 > 5 ? -spec.h1 : -1e9, hi = spec.h1 > 5 ? 0 : 0.25 * nom.rk;
    var cntBand = 0;
    for (i = 0; i < n; i++) {
      var zz = q[3 * i + 2]; if (zz < lo || zz > hi || zz < zmin) continue;
      if (Math.abs(dev[i]) > outlierLim) continue;
      var th = Math.atan2(q[3 * i + 1], q[3 * i]); var bi = Math.min(bins - 1, Math.floor((th + PI) / (2 * PI) * bins));
      band[bi].push(Math.hypot(q[3 * i], q[3 * i + 1])); cntBand++;
    }
    if (spec.h1 > 5 && cntBand < 300) { // fall back to knuckle start
      for (i = 0; i < bins; i++) band[i] = [];
      for (i = 0; i < n; i++) { zz = q[3 * i + 2]; if (zz < -1 || zz > 0.25 * nom.rk || Math.abs(dev[i]) > outlierLim) continue; th = Math.atan2(q[3 * i + 1], q[3 * i]); bi = Math.min(bins - 1, Math.floor((th + PI) / (2 * PI) * bins)); band[bi].push(Math.hypot(q[3 * i], q[3 * i + 1]) - (dev[i] - (Math.hypot(q[3 * i], q[3 * i + 1]) - nom.Ro))); }
    }
    var bm = band.map(function (b) { return b.length >= 5 ? median(b) : null; });
    var diams = [];
    for (i = 0; i < bins / 2; i++) if (bm[i] != null && bm[i + bins / 2] != null) diams.push(bm[i] + bm[i + bins / 2]);
    var roundness = diams.length >= 4 ? { dMax: Math.max.apply(null, diams), dMin: Math.min.apply(null, diams), dMean: diams.reduce(function (s, v) { return s + v; }, 0) / diams.length, pairs: diams.length } : null;
    // coverage: angular bins with points in head region
    var cov = new Uint8Array(72);
    for (i = 0; i < n; i++) if (inReg[i] && Math.abs(dev[i]) < outlierLim) { th = Math.atan2(q[3 * i + 1], q[3 * i]); cov[Math.min(71, Math.floor((th + PI) / (2 * PI) * 72))] = 1; }
    var coverage = cov.reduce(function (s, v) { return s + v; }, 0) / 72 * 100;

    var res = {
      spec: spec, tol: tol, nominal: nom, actual: actual, pose: pose, base: best.base, unitFactor: unit,
      scaleMode: opts.scaleMode, circDiameter: circNote, zmin: zmin,
      q: q, dev: dev, t: tpar, inReg: inReg, stats: stats, roundness: roundness, coverage: coverage, outlierLim: outlierLim
    };
    res.checks = buildChecks(res);
    prog(1, 'Done');
    return res;
  }

  function buildChecks(r) {
    var tol = r.tol, spec = r.spec, nom = r.nominal, act = r.actual, out = [];
    var off = spec.ref === 'inside' ? spec.s : 0;
    function add(key, label, nominal, measured, limitTxt, ok, unit, note) { out.push({ key: key, label: label, nominal: nominal, measured: measured, limit: limitTxt, status: ok == null ? 'na' : ok ? 'pass' : 'fail', unit: unit || 'mm', note: note || '' }); }
    add('profile', 'Profile deviation (P99 of |dev|)', 0, r.stats.abs99, '± ' + tol.profile, r.stats.abs99 <= tol.profile, 'mm',
      r.stats.pctIn.toFixed(1) + '% of points within tolerance');
    // Diameter
    if (r.scaleMode === 'scale') {
      var dMeas = r.roundness ? r.roundness.dMean : 2 * act.Ro;
      add('diameter', 'Outside diameter', spec.Da, dMeas, '± ' + tol.diameter, Math.abs(dMeas - spec.Da) <= tol.diameter);
    } else if (r.scaleMode === 'circ' && r.circDiameter) {
      add('diameter', 'Outside diameter (from circumference)', spec.Da, r.circDiameter, '± ' + tol.diameter, Math.abs(r.circDiameter - spec.Da) <= tol.diameter, 'mm', 'Taken from your tape measurement');
    } else add('diameter', 'Outside diameter', spec.Da, null, '± ' + tol.diameter, null, 'mm', 'Not checked: scan scale unknown');
    if (r.roundness) {
      var ov = r.roundness.dMax - r.roundness.dMin;
      add('ovality', 'Out of roundness (Dmax − Dmin)', 0, ov, '≤ ' + tol.ovality, ov <= tol.ovality, 'mm', r.roundness.pairs + ' diameter pairs measured');
    } else add('ovality', 'Out of roundness', 0, null, '≤ ' + tol.ovality, null, 'mm', 'Too few points near the tangent line');
    var hAct = act.H, freeOk = r.scaleMode !== 'free';
    add('height', 'Height above tangent line', nom.H, freeOk ? hAct : null, '± ' + tol.height, freeOk ? Math.abs(hAct - nom.H) <= tol.height : null, 'mm', freeOk ? '' : 'Not checked: scan scale unknown');
    if (nom.kind === 'tori') {
      var rcN = nom.Rc - off, rcA = act.Rc - off;
      add('crown', 'Crown radius R', rcN, rcA, '± ' + tol.crownPct + '%', Math.abs(rcA - rcN) / rcN * 100 <= tol.crownPct, 'mm', spec.ref === 'inside' ? 'Inside radius' : 'Outside radius');
      var rkN = nom.rk - off, rkA = act.rk - off;
      add('knuckle', 'Knuckle radius r', rkN, rkA, '≥ −' + tol.knucklePct + '%', rkA >= rkN * (1 - tol.knucklePct / 100), 'mm', spec.ref === 'inside' ? 'Inside radius' : 'Outside radius');
    } else {
      add('slope', 'Cone slope from horizontal', nom.beta, act.beta, '± ' + tol.slopeDeg + '°', Math.abs(act.beta - nom.beta) <= tol.slopeDeg, '°');
      var rkN2 = nom.rk - off, rkA2 = act.rk - off;
      add('knuckle', 'Knuckle radius r', rkN2, rkA2, '≥ −' + tol.knucklePct + '%', rkA2 >= rkN2 * (1 - tol.knucklePct / 100), 'mm');
    }
    return out;
  }

  /* ---------------- Solid from scan ----------------
     Grid over (theta, t): median deviation per cell, gaps filled from neighbours,
     outer surface = nominal + dev along normal, inner = outer - s. */
  function buildSolid(r, opt) {
    opt = opt || {};
    var nTh = opt.nTh || 72, nT = opt.nT || 48, nom = r.nominal, s = Math.max(0.5, r.spec.s || 1);
    var tMax = Math.min(nom.tEnd, nom.tKn - r.zmin);
    var cells = []; for (var i = 0; i < nTh * nT; i++) cells.push([]);
    var q = r.q, n = r.dev.length;
    for (i = 0; i < n; i++) {
      if (!r.inReg[i] || Math.abs(r.dev[i]) > r.outlierLim) continue;
      var th = Math.atan2(q[3 * i + 1], q[3 * i]); var a = Math.min(nTh - 1, Math.floor((th + Math.PI) / (2 * Math.PI) * nTh));
      var b = Math.round(r.t[i] / tMax * (nT - 1)); if (b < 0 || b >= nT) continue;
      cells[b * nTh + a].push(r.dev[i]);
    }
    var D = new Float64Array(nTh * nT), has = new Uint8Array(nTh * nT), filled = 0;
    var wSum = 0, wHas = 0;
    for (i = 0; i < nTh * nT; i++) {
      var wr = Math.max(1, nom.evalAt(Math.floor(i / nTh) / (nT - 1) * tMax)[0]); wSum += wr;
      if (cells[i].length) { D[i] = median(cells[i]); has[i] = 1; filled++; wHas += wr; }
    }
    var coverage = wHas / wSum * 100; // area weighted
    // fill gaps: iterative neighbour averaging (theta wraps); cells never reached stay nominal (0)
    var known = has.slice();
    for (var pass = 0; pass < 200; pass++) {
      var changed = 0, nk = known.slice(), ND = D.slice();
      for (var bj = 0; bj < nT; bj++) for (var ai = 0; ai < nTh; ai++) {
        var id = bj * nTh + ai; if (known[id]) continue;
        var sum = 0, cnt = 0, nb = [[ai - 1, bj], [ai + 1, bj], [ai, bj - 1], [ai, bj + 1]];
        for (var m = 0; m < 4; m++) { var x = (nb[m][0] + nTh) % nTh, y = nb[m][1]; if (y < 0 || y >= nT) continue; var k = y * nTh + x; if (known[k]) { sum += D[k]; cnt++; } }
        if (cnt) { ND[id] = sum / cnt; nk[id] = 1; changed++; }
      }
      D = ND; known = nk; if (!changed) break;
    }
    // light smoothing to suppress scan noise
    var S = D.slice();
    for (bj = 0; bj < nT; bj++) for (ai = 0; ai < nTh; ai++) {
      sum = 0; cnt = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { y = bj + dy; if (y < 0 || y >= nT) continue; x = (ai + dx + nTh) % nTh; sum += D[y * nTh + x]; cnt++; }
      S[bj * nTh + ai] = sum / cnt;
    }
    var verts = [], tris = [], vdev = [];
    function vtx(ai, bj, inner) {
      var t = bj / (nT - 1) * tMax, e = nom.evalAt(t), dv = S[bj * nTh + ai] - (inner ? s : 0);
      var rho = e[0] + dv * e[2], z = e[1] + dv * e[3], th = -Math.PI + (ai + 0.5) / nTh * 2 * Math.PI;
      return [rho * Math.cos(th), rho * Math.sin(th), z];
    }
    var pole = nom.pole, j0 = pole ? 1 : 0;
    var idxO = [], idxI = [];
    for (bj = j0; bj < nT; bj++) { idxO[bj] = []; idxI[bj] = []; for (ai = 0; ai < nTh; ai++) { idxO[bj][ai] = verts.length; verts.push(vtx(ai, bj, false)); vdev.push(S[bj * nTh + ai]); idxI[bj][ai] = verts.length; verts.push(vtx(ai, bj, true)); vdev.push(null); } }
    var pO, pI;
    if (pole) {
      var dm = 0; for (ai = 0; ai < nTh; ai++) dm += S[ai] / nTh;
      var e0 = nom.evalAt(0); pO = verts.length; verts.push([0, 0, e0[1] + dm]); vdev.push(dm); pI = verts.length; verts.push([0, 0, e0[1] + dm - s]); vdev.push(null);
      for (ai = 0; ai < nTh; ai++) { var a2 = (ai + 1) % nTh; tris.push([pO, idxO[1][ai], idxO[1][a2]]); tris.push([pI, idxI[1][a2], idxI[1][ai]]); }
    }
    for (bj = j0; bj < nT - 1; bj++) for (ai = 0; ai < nTh; ai++) {
      a2 = (ai + 1) % nTh;
      var A = idxO[bj][ai], B = idxO[bj][a2], Cc = idxO[bj + 1][a2], Dd = idxO[bj + 1][ai];
      tris.push([A, Cc, B]); tris.push([A, Dd, Cc]);
      A = idxI[bj][ai]; B = idxI[bj][a2]; Cc = idxI[bj + 1][a2]; Dd = idxI[bj + 1][ai];
      tris.push([A, B, Cc]); tris.push([A, Cc, Dd]);
    }
    var L = nT - 1;
    for (ai = 0; ai < nTh; ai++) {
      a2 = (ai + 1) % nTh;
      tris.push([idxO[L][ai], idxI[L][a2], idxO[L][a2]]); tris.push([idxO[L][ai], idxI[L][ai], idxI[L][a2]]);
      if (!pole) { tris.push([idxO[0][ai], idxO[0][a2], idxI[0][a2]]); tris.push([idxO[0][ai], idxI[0][a2], idxI[0][ai]]); }
    }
    // signed volume check, flip if inside-out
    var vol = 0;
    tris.forEach(function (tr) { var p = verts[tr[0]], q2 = verts[tr[1]], w = verts[tr[2]]; vol += (p[0] * (q2[1] * w[2] - q2[2] * w[1]) - p[1] * (q2[0] * w[2] - q2[2] * w[0]) + p[2] * (q2[0] * w[1] - q2[1] * w[0])) / 6; });
    if (vol < 0) tris = tris.map(function (tr) { return [tr[0], tr[2], tr[1]]; });
    return { verts: verts, tris: tris, vdev: vdev, volume: Math.abs(vol), coverage: coverage, devGrid: S, nTh: nTh, nT: nT };
  }

  /* ---------------- Export helpers ---------------- */
  function originShift(r, origin) { return origin === 'flange' ? r.spec.h1 : origin === 'apex' ? -r.nominal.H : 0; }
  function f3(v) { var s = (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3); return s; }
  function stepHeader(name, desc) {
    var now = new Date().toISOString().slice(0, 19);
    return 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'' + desc + '\'),\'2;1\');\nFILE_NAME(\'' + name + '\',\'' + now + '\',(\'Gpi Shape Check\'),(\'Gpi Group\'),\'Gpi Shape Check\',\'Gpi Shape Check\',\'\');\nFILE_SCHEMA((\'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }\'));\nENDSEC;\nDATA;\n';
  }
  function stepContext(L, id, prodName) {
    L.push('#1=APPLICATION_CONTEXT(\'automotive design\');');
    L.push('#2=APPLICATION_PROTOCOL_DEFINITION(\'international standard\',\'automotive_design\',2000,#1);');
    L.push('#3=PRODUCT_CONTEXT(\'\',#1,\'mechanical\');');
    L.push('#4=PRODUCT(\'' + prodName + '\',\'' + prodName + '\',\'\',(#3));');
    L.push('#5=PRODUCT_DEFINITION_FORMATION(\'\',\'\',#4);');
    L.push('#6=PRODUCT_DEFINITION_CONTEXT(\'part definition\',#1,\'design\');');
    L.push('#7=PRODUCT_DEFINITION(\'design\',\'\',#5,#6);');
    L.push('#8=PRODUCT_DEFINITION_SHAPE(\'\',\'\',#7);');
    L.push('#9=PRODUCT_RELATED_PRODUCT_CATEGORY(\'part\',$,(#4));');
    L.push('#10=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));');
    L.push('#11=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));');
    L.push('#12=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());');
    L.push('#13=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-03),#10,\'distance_accuracy_value\',\'\');');
    L.push('#14=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#13))GLOBAL_UNIT_ASSIGNED_CONTEXT((#10,#11,#12))REPRESENTATION_CONTEXT(\'\',\'\'));');
    L.push('#15=CARTESIAN_POINT(\'\',(0.,0.,0.));');
    L.push('#16=DIRECTION(\'\',(0.,0.,1.));');
    L.push('#17=DIRECTION(\'\',(1.,0.,0.));');
    L.push('#18=AXIS2_PLACEMENT_3D(\'\',#15,#16,#17);');
    return 19;
  }
  function safeName(s) { return String(s || 'part').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 40) || 'part'; }

  // Points (scan, aligned) + nominal wireframe
  function stepPointCloud(r, opt) {
    opt = opt || {}; var name = opt.name || 'shapecheck', maxPts = opt.maxPts || 60000, dz = originShift(r, opt.origin);
    var L = [], id = stepContext(L, 0, safeName(opt.part));
    var items = [], q = r.q, n = r.dev.length, step = Math.max(1, Math.ceil(n / maxPts));
    for (var i = 0; i < n; i += step) {
      if (!r.inReg[i] && !opt.includeAll) continue;
      if (Math.abs(r.dev[i]) > r.outlierLim) continue;
      L.push('#' + id + '=CARTESIAN_POINT(\'\',(' + f3(q[3 * i]) + ',' + f3(q[3 * i + 1]) + ',' + f3(q[3 * i + 2] + dz) + '));'); items.push(id++);
    }
    var nom = r.nominal, nM = 24, nS = 120;
    for (var m = 0; m < nM; m++) { // meridians
      var th = m / nM * 2 * Math.PI, ids = [];
      for (var k = 0; k <= nS; k++) { var e = nom.evalAt(k / nS * nom.tEnd); L.push('#' + id + '=CARTESIAN_POINT(\'\',(' + f3(e[0] * Math.cos(th)) + ',' + f3(e[0] * Math.sin(th)) + ',' + f3(e[1] + dz) + '));'); ids.push('#' + (id++)); }
      L.push('#' + id + '=POLYLINE(\'nominal meridian\',(' + ids.join(',') + '));'); items.push(id++);
    }
    [0, nom.tKn, nom.tEnd].forEach(function (tt) { // rings at tangent line and flange end
      var e = nom.evalAt(tt), ids = []; if (e[0] < 1) return;
      for (var k = 0; k <= 144; k++) { var th = k / 144 * 2 * Math.PI; L.push('#' + id + '=CARTESIAN_POINT(\'\',(' + f3(e[0] * Math.cos(th)) + ',' + f3(e[0] * Math.sin(th)) + ',' + f3(e[1] + dz) + '));'); ids.push('#' + (id++)); }
      L.push('#' + id + '=POLYLINE(\'nominal ring\',(' + ids.join(',') + '));'); items.push(id++);
    });
    var gcs = id++;
    var chunks = []; for (i = 0; i < items.length; i += 12) chunks.push(items.slice(i, i + 12).map(function (v) { return '#' + v; }).join(','));
    L.push('#' + gcs + '=GEOMETRIC_CURVE_SET(\'scan points\',(' + chunks.join(',\n') + '));');
    var rep = id++; L.push('#' + rep + '=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION(\'\',(#' + gcs + ',#18),#14);');
    L.push('#' + (id++) + '=SHAPE_DEFINITION_REPRESENTATION(#8,#' + rep + ');');
    return stepHeader(name + '.stp', 'Gpi Shape Check aligned scan points') + L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  function stepSolid(solid, r, opt) {
    opt = opt || {}; var name = opt.name || 'shapecheck_solid', dz = originShift(r, opt.origin);
    var L = [], id = stepContext(L, 0, safeName(opt.part)), vid = [];
    solid.verts.forEach(function (v) { L.push('#' + id + '=CARTESIAN_POINT(\'\',(' + f3(v[0]) + ',' + f3(v[1]) + ',' + f3(v[2] + dz) + '));'); vid.push(id++); });
    var faces = [];
    solid.tris.forEach(function (t) {
      var a = solid.verts[t[0]], b = solid.verts[t[1]], c = solid.verts[t[2]];
      var nrm = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      var l = Math.hypot(nrm[0], nrm[1], nrm[2]); if (l < 1e-9) return; nrm = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
      var pl = id++; L.push('#' + pl + '=POLY_LOOP(\'\',(#' + vid[t[0]] + ',#' + vid[t[1]] + ',#' + vid[t[2]] + '));');
      var fb = id++; L.push('#' + fb + '=FACE_OUTER_BOUND(\'\',#' + pl + ',.T.);');
      var dn = id++; L.push('#' + dn + '=DIRECTION(\'\',(' + nrm[0].toFixed(6) + ',' + nrm[1].toFixed(6) + ',' + nrm[2].toFixed(6) + '));');
      var ax = id++; L.push('#' + ax + '=AXIS2_PLACEMENT_3D(\'\',#' + vid[t[0]] + ',#' + dn + ',$);');
      var pn = id++; L.push('#' + pn + '=PLANE(\'\',#' + ax + ');');
      var fs = id++; L.push('#' + fs + '=FACE_SURFACE(\'\',(#' + fb + '),#' + pn + ',.T.);'); faces.push(fs);
    });
    var chunks = []; for (var i = 0; i < faces.length; i += 12) chunks.push(faces.slice(i, i + 12).map(function (v) { return '#' + v; }).join(','));
    var cs = id++; L.push('#' + cs + '=CLOSED_SHELL(\'\',(' + chunks.join(',\n') + '));');
    var fbr = id++; L.push('#' + fbr + '=FACETED_BREP(\'scan solid\',#' + cs + ');');
    var rep = id++; L.push('#' + rep + '=FACETED_BREP_SHAPE_REPRESENTATION(\'\',(#' + fbr + ',#18),#14);');
    L.push('#' + (id++) + '=SHAPE_DEFINITION_REPRESENTATION(#8,#' + rep + ');');
    return stepHeader(name + '.stp', 'Gpi Shape Check solid from scan') + L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  function stlBinary(solid, r, opt) {
    var dz = originShift(r, (opt || {}).origin), nt = solid.tris.length;
    var buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf), hdr = 'Gpi Shape Check solid from scan, mm';
    for (var i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 32);
    dv.setUint32(80, nt, true);
    var o = 84;
    solid.tris.forEach(function (t) {
      var a = solid.verts[t[0]], b = solid.verts[t[1]], c = solid.verts[t[2]];
      var nrm = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      [nrm, a, b, c].forEach(function (v, k) { dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, k ? v[2] + dz : v[2], true); o += 12; });
      dv.setUint16(o, 0, true); o += 2;
    });
    return buf;
  }

  function igesPoints(r, opt) {
    opt = opt || {}; var dz = originShift(r, opt.origin), maxPts = opt.maxPts || 40000;
    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s.slice(0, n); }
    function rj(v, n) { v = String(v); while (v.length < n) v = ' ' + v; return v; }
    function h(s) { return s.length + 'H' + s; }
    var S = ['Gpi Shape Check aligned scan points, mm'], now = new Date();
    var ds = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '.' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
    var gStr = ['1H,', '1H;', h('ShapeCheck'), h((opt.name || 'shapecheck') + '.igs'), h('Gpi Shape Check'), h('0.1'), '32', '38', '6', '308', '15', h('ShapeCheck'), '1.0', '2', h('MM'), '1', '1.0', h(ds), '0.001', '100000.0', h('Gpi'), h('Gpi Group'), '11', '0', h(ds)].join(',') + ';';
    var G = []; for (var i = 0; i < gStr.length; i += 72) G.push(gStr.slice(i, i + 72));
    var D = [], P = [], q = r.q, n = r.dev.length, step = Math.max(1, Math.ceil(n / maxPts));
    for (i = 0; i < n; i += step) {
      if (!r.inReg[i] || Math.abs(r.dev[i]) > r.outlierLim) continue;
      var de = D.length + 1, pl = P.length + 1;
      P.push({ s: '116,' + f3(q[3 * i]) + ',' + f3(q[3 * i + 1]) + ',' + f3(q[3 * i + 2] + dz) + ',0;', de: de });
      D.push(rj(116, 8) + rj(pl, 8) + rj(0, 8) + rj(0, 8) + rj(0, 8) + rj(0, 8) + rj(0, 8) + rj(0, 8) + '00000000');
      D.push(rj(116, 8) + rj(0, 8) + rj(0, 8) + rj(1, 8) + rj(0, 8) + rj('', 8) + rj('', 8) + rj('POINT', 8) + rj(0, 8));
    }
    var out = [];
    S.forEach(function (l, k) { out.push(pad(l, 72) + 'S' + rj(k + 1, 7)); });
    G.forEach(function (l, k) { out.push(pad(l, 72) + 'G' + rj(k + 1, 7)); });
    D.forEach(function (l, k) { out.push(pad(l, 72) + 'D' + rj(k + 1, 7)); });
    P.forEach(function (p, k) { out.push(pad(p.s, 64) + rj(p.de, 8) + 'P' + rj(k + 1, 7)); });
    out.push(pad('S' + rj(S.length, 7) + 'G' + rj(G.length, 7) + 'D' + rj(D.length, 7) + 'P' + rj(P.length, 7), 72) + 'T' + rj(1, 7));
    return out.join('\n') + '\n';
  }

  function csvDeviations(r, opt) {
    var dz = originShift(r, (opt || {}).origin), q = r.q, n = r.dev.length, L = ['x_mm;y_mm;z_mm;deviation_mm;meridian_mm;in_region'];
    for (var i = 0; i < n; i++) L.push([f3(q[3 * i]), f3(q[3 * i + 1]), f3(q[3 * i + 2] + dz), r.dev[i].toFixed(3), r.t[i].toFixed(1), r.inReg[i]].join(';').replace(/\./g, ','));
    return L.join('\n');
  }

  /* ---------------- Parsers ---------------- */
  var PLYT = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  function readNum(dv, o, type, le) {
    switch (type) {
      case 'char': case 'int8': return dv.getInt8(o); case 'uchar': case 'uint8': return dv.getUint8(o);
      case 'short': case 'int16': return dv.getInt16(o, le); case 'ushort': case 'uint16': return dv.getUint16(o, le);
      case 'int': case 'int32': return dv.getInt32(o, le); case 'uint': case 'uint32': return dv.getUint32(o, le);
      case 'float': case 'float32': return dv.getFloat32(o, le); default: return dv.getFloat64(o, le);
    }
  }
  function parsePLY(buf) {
    var bytes = new Uint8Array(buf), head = '', i = 0;
    while (i < bytes.length && i < 100000) { head += String.fromCharCode(bytes[i++]); if (head.endsWith('end_header\n') || head.endsWith('end_header\r\n')) break; }
    var lines = head.split(/\r?\n/), fmt = 'ascii', elems = [], cur = null;
    lines.forEach(function (l) {
      var t = l.trim().split(/\s+/);
      if (t[0] === 'format') fmt = t[1];
      else if (t[0] === 'element') { cur = { name: t[1], count: +t[2], props: [] }; elems.push(cur); }
      else if (t[0] === 'property' && cur) { if (t[1] === 'list') cur.props.push({ list: true, ct: t[2], it: t[3], name: t[4] }); else cur.props.push({ type: t[1], name: t[2] }); }
    });
    var vE = elems.find(function (e) { return e.name === 'vertex'; }); if (!vE) throw new Error('PLY file has no vertex data.');
    var ix = vE.props.findIndex(function (p) { return p.name === 'x'; }), iy = vE.props.findIndex(function (p) { return p.name === 'y'; }), iz = vE.props.findIndex(function (p) { return p.name === 'z'; });
    var out = new Float32Array(vE.count * 3);
    if (fmt === 'ascii') {
      var body = new TextDecoder().decode(bytes.subarray(i)).split(/\r?\n/), li = 0;
      for (var e = 0; e < elems.length; e++) {
        if (elems[e] !== vE) { li += elems[e].count; continue; }
        for (var k = 0; k < vE.count; k++) { var t = body[li++].trim().split(/\s+/); out[3 * k] = +t[ix]; out[3 * k + 1] = +t[iy]; out[3 * k + 2] = +t[iz]; }
        break;
      }
    } else {
      var le = fmt === 'binary_little_endian', dv = new DataView(buf), o = i;
      for (e = 0; e < elems.length; e++) {
        var E = elems[e];
        if (E !== vE) {
          if (E.props.some(function (p) { return p.list; })) { if (e > elems.indexOf(vE)) break; for (k = 0; k < E.count; k++) E.props.forEach(function (p) { if (p.list) { var c = readNum(dv, o, p.ct, le); o += PLYT[p.ct] + c * PLYT[p.it]; } else o += PLYT[p.type]; }); }
          else o += E.count * E.props.reduce(function (s, p) { return s + PLYT[p.type]; }, 0);
          continue;
        }
        if (E.props.some(function (p) { return p.list; })) throw new Error('Unsupported PLY vertex layout.');
        var offs = [], acc = 0; E.props.forEach(function (p) { offs.push(acc); acc += PLYT[p.type]; });
        for (k = 0; k < E.count; k++) { out[3 * k] = readNum(dv, o + offs[ix], E.props[ix].type, le); out[3 * k + 1] = readNum(dv, o + offs[iy], E.props[iy].type, le); out[3 * k + 2] = readNum(dv, o + offs[iz], E.props[iz].type, le); o += acc; }
        break;
      }
    }
    return out;
  }
  function parseSTL(buf) {
    var dv = new DataView(buf), n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    if (n > 0 && 84 + n * 50 === buf.byteLength) {
      var out = new Float32Array(n * 9);
      for (var i = 0; i < n; i++) for (var k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
      return out;
    }
    return parseVertexLines(new TextDecoder().decode(buf), /^\s*vertex\s+/i);
  }
  function parseVertexLines(text, re) {
    var arr = [], lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) { var l = lines[i]; if (!re.test(l)) continue; var t = l.replace(re, '').trim().split(/\s+/); arr.push(+t[0], +t[1], +t[2]); }
    return Float32Array.from(arr);
  }
  function parseXYZ(text) {
    var arr = [], lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim(); if (!t) continue;
      var m = t.split(/[\s;,\t]+/); if (m.length < 3) continue;
      // tolerate decimal comma when semicolon separated
      if (/;/.test(t)) m = t.split(';').map(function (s) { return s.replace(',', '.'); });
      var x = parseFloat(m[0]), y = parseFloat(m[1]), z = parseFloat(m[2]);
      if (isFinite(x) && isFinite(y) && isFinite(z)) arr.push(x, y, z);
    }
    return Float32Array.from(arr);
  }
  function parseGLB(buf) {
    var dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a valid GLB file.');
    var off = 12, json = null, bin = null;
    while (off < buf.byteLength) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004E4942) bin = off + 8;
      off += 8 + len;
    }
    if (!json || bin == null) throw new Error('GLB file has no geometry.');
    if ((json.extensionsUsed || []).indexOf('KHR_draco_mesh_compression') >= 0) throw new Error('This GLB is Draco compressed. Export it without compression, or as OBJ or PLY.');
    var arr = [];
    (json.meshes || []).forEach(function (m) {
      (m.primitives || []).forEach(function (p) {
        var ai = p.attributes && p.attributes.POSITION; if (ai == null) return;
        var acc = json.accessors[ai], bv = json.bufferViews[acc.bufferView];
        if (acc.componentType !== 5126 || acc.type !== 'VEC3') return;
        var stride = bv.byteStride || 12, base = bin + (bv.byteOffset || 0) + (acc.byteOffset || 0);
        for (var i = 0; i < acc.count; i++) { var o = base + i * stride; arr.push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)); }
      });
    });
    return Float32Array.from(arr);
  }
  function parseFile(name, buf) {
    var ext = (name.split('.').pop() || '').toLowerCase(), pts;
    if (ext === 'ply') pts = parsePLY(buf);
    else if (ext === 'glb') pts = parseGLB(buf);
    else if (ext === 'stl') pts = parseSTL(buf);
    else if (ext === 'obj') pts = parseVertexLines(new TextDecoder().decode(buf), /^v\s+/);
    else pts = parseXYZ(new TextDecoder().decode(buf));
    // drop non-finite
    var ok = [], n = pts.length / 3;
    for (var i = 0; i < n; i++) if (isFinite(pts[3 * i]) && isFinite(pts[3 * i + 1]) && isFinite(pts[3 * i + 2])) ok.push(i);
    if (ok.length !== n) { var o2 = new Float32Array(ok.length * 3); ok.forEach(function (k, j) { o2[3 * j] = pts[3 * k]; o2[3 * j + 1] = pts[3 * k + 1]; o2[3 * j + 2] = pts[3 * k + 2]; }); pts = o2; }
    if (pts.length / 3 < 200) throw new Error('Only ' + (pts.length / 3) + ' points found. Export the scan as PLY, OBJ, GLB, STL or XYZ with at least a few thousand points.');
    if (pts.length / 3 > 400000) pts = Float32Array.from(subsample(pts, 400000, 99));
    return pts;
  }

  /* ---------------- Sample scan (synthetic) ---------------- */
  function sampleScan(spec, opt) {
    opt = opt || {}; var nom = buildModel(spec), N = opt.n || 30000, shell = opt.shell || 150, r = 4242;
    function rnd() { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; }
    function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }
    var tEnd = nom.tEnd + shell, pts = new Float32Array(N * 3);
    var dentTh = 0.8, dentT = nom.tCrown * 0.55;
    var rot = matMul(rotXY(0.35, -0.6), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), off = [812, -430, 260];
    for (var i = 0; i < N; i++) {
      // area-weighted sampling along t (weight ~ rho)
      var t, e;
      do { t = rnd() * tEnd; e = nom.evalAt(Math.min(t, nom.tEnd)); if (t > nom.tEnd) e = [nom.Ro, -(t - nom.tKn), 1, 0]; } while (rnd() * nom.Ro > e[0] + 20);
      var th = (rnd() * 2 - 1) * Math.PI;
      var dv = gauss() * 1.0;
      dv += 4 * Math.cos(2 * th) * Math.min(1, t / nom.tKn); // ovality grows toward the rim
      var dd = Math.hypot((th - dentTh) * nom.Ro * 0.6, t - dentT); dv -= 6 * Math.exp(-dd * dd / (2 * 120 * 120)); // dent
      if (rnd() < 0.006) dv += (rnd() - 0.5) * 120; // spikes
      var rho = e[0] + dv * e[2], z = e[1] + dv * e[3];
      var p = [rho * Math.cos(th), rho * Math.sin(th), z];
      var w = [rot[0][0] * p[0] + rot[0][1] * p[1] + rot[0][2] * p[2], rot[1][0] * p[0] + rot[1][1] * p[1] + rot[1][2] * p[2], rot[2][0] * p[0] + rot[2][1] * p[1] + rot[2][2] * p[2]];
      // sample stored in metres, like most scan apps
      pts[3 * i] = (w[0] + off[0]) / 1000; pts[3 * i + 1] = (w[1] + off[1]) / 1000; pts[3 * i + 2] = (w[2] + off[2]) / 1000;
    }
    return pts;
  }

  function modelParams(m) { var o = {}; ['kind', 'Ro', 'Rc', 'rk', 'h1', 'beta', 'rTop', 'H', 'tCrown', 'tKn', 'tEnd', 'pole'].forEach(function (k) { if (m[k] !== undefined) o[k] = m[k]; }); return o; }
  function modelFromParams(p) { return p.kind === 'tori' ? toriModel(p.Ro, p.Rc, p.rk, p.h1) : coneModel(p.Ro, p.rk, p.beta, p.rTop, p.h1); }
  function analyzeAll(pts, opts, prog) {
    var r = analyze(pts, opts, prog), solid = buildSolid(r);
    var out = {}; for (var k in r) out[k] = r[k];
    out.nominal = modelParams(r.nominal); out.actual = modelParams(r.actual);
    return { res: out, solid: solid };
  }
  function rehydrate(res) { res.nominal = modelFromParams(res.nominal); res.actual = modelFromParams(res.actual); return res; }
  return {
    analyzeAll: analyzeAll, rehydrate: rehydrate, modelFromParams: modelFromParams,
    buildModel: buildModel, nominalRadii: nominalRadii, analyze: analyze, buildSolid: buildSolid,
    stepPointCloud: stepPointCloud, stepSolid: stepSolid, stlBinary: stlBinary, igesPoints: igesPoints, csvDeviations: csvDeviations,
    parseFile: parseFile, sampleScan: sampleScan, autoUnit: autoUnit, originShift: originShift, safeName: safeName, percentile: percentile
  };
})();
if (typeof module !== 'undefined') module.exports = SC;
