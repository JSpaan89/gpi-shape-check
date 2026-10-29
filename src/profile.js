/* Gpi Shape Check profile: from the outline in side photos of a round part
   (head, cone) to 3D points in mm for core.js.
   Each photo gives two meridians (left and right edge). Photos are taken spread
   evenly over half a turn, so photo k of n looks along angle k * 180 / n.
   No DOM access, so it can be tested in node. */
var PRO = (function () {
  'use strict';

  var BASE_BAND = 0.1;   // lowest share of the outline used for the base width
  // core.js measures roundness in 10 degree bins; half a bin off keeps every
  // meridian (and its opposite) clear of a bin edge
  var ANGLE_OFFSET = Math.PI / 72;

  function median(a) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // mm per px from two tapped ends of a ruler or scale bar of known length
  function rulerScale(p1, p2, lengthMm) {
    var d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (!(d > 1) || !(lengthMm > 0)) throw new Error('Tap both ends of the ruler and enter its length.');
    return lengthMm / d;
  }

  // least squares line x = a + b * y through the mid points of the rows
  function fitAxis(mids) {
    var n = mids.length, sy = 0, sx = 0, syy = 0, sxy = 0;
    mids.forEach(function (m) { sy += m.y; sx += m.x; syy += m.y * m.y; sxy += m.x * m.y; });
    var den = n * syy - sy * sy, b = den ? (n * sxy - sx * sy) / den : 0;
    return { a: (sx - b * sy) / n, b: b };
  }

  /* edges: SIL.analyzeImage result. opts: {mmPerPx} from a ruler, or {Da} to scale
     from the nominal outside diameter at the bottom of the outline.
     Returns {pts:[{rho, z, side}], mmPerPx, scaleSource, axisX, tilt, baseWidthPx}:
     rho = distance from the axis in mm, z = height along the axis in mm (up). */
  function fromEdges(edges, opts) {
    opts = opts || {};
    var right = {}, mids = [];
    edges.right.forEach(function (p) { right[p.y] = p.x; });
    edges.left.forEach(function (p) { if (right[p.y] != null) mids.push({ y: p.y, x: (p.x + right[p.y]) / 2, w: right[p.y] - p.x }); });
    if (mids.length < 10) throw new Error('No outline found in this photo. Check the background and the search box.');
    var ax = fitAxis(mids), n = Math.sqrt(1 + ax.b * ax.b);
    var perp = function (p) { return (p.x - ax.a - ax.b * p.y) / n; };
    var along = function (p) { return (ax.b * (p.x - ax.a) + p.y) / n; };

    var yMax = mids[mids.length - 1].y, yMin = mids[0].y, cut = yMax - BASE_BAND * (yMax - yMin);
    var base = median(mids.filter(function (m) { return m.y >= cut; }).map(function (m) { return m.w / n; }));
    var k = opts.mmPerPx, source = 'ruler';
    if (!(k > 0)) {
      if (!(opts.Da > 0)) throw new Error('No scale: tap the ruler, or enter the outside diameter.');
      k = opts.Da / base; source = 'nominal';
    }
    var pts = [];
    function add(p) { var d = perp(p); pts.push({ rho: Math.abs(d) * k, z: -along(p) * k, side: d >= 0 ? 1 : -1 }); }
    edges.left.forEach(add); edges.right.forEach(add); edges.top.forEach(add);
    return { pts: pts, mmPerPx: k, scaleSource: source, axisX: ax.a + ax.b * median(mids.map(function (m) { return m.y; })), tilt: ax.b, baseWidthPx: base };
  }

  /* views: fromEdges results in the order taken, spread over half a turn.
     Returns xyz in mm (Float64Array) for SC.analyze with unitFactor 1. */
  function toPoints(views) {
    if (!views || !views.length) throw new Error('Add at least one photo.');
    var total = views.reduce(function (s, v) { return s + v.pts.length; }, 0), xyz = new Float64Array(total * 3), i = 0;
    views.forEach(function (v, kv) {
      var th = ANGLE_OFFSET + kv * Math.PI / views.length;
      v.pts.forEach(function (p) {
        var t = p.side > 0 ? th : th + Math.PI;
        xyz[i++] = p.rho * Math.cos(t); xyz[i++] = p.rho * Math.sin(t); xyz[i++] = p.z;
      });
    });
    return xyz;
  }

  return { rulerScale: rulerScale, fromEdges: fromEdges, toPoints: toPoints };
})();
if (typeof module !== 'undefined') module.exports = PRO;
