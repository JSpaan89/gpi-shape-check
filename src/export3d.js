/* Gpi Shape Check 3D exports next to core.js: binary PLY with deviation colours,
   which Blender opens directly (Import, Stanford PLY; colours as vertex colour).
   No DOM access, so it can be tested in node. */
var EX3 = (function (SC) {
  'use strict';

  // deviation / tolerance -> colour: blue inside, green on nominal, red outside
  var STOPS = [[-2, [0x2b, 0x59, 0xc3]], [-1, [0x4f, 0xb3, 0xe8]], [0, [0x3b, 0xb2, 0x73]], [1, [0xf2, 0xc1, 0x4e]], [2, [0xd7, 0x26, 0x3d]]];
  var NO_DATA = [184, 189, 191];

  function devColor(d, tol) {
    if (d == null || !isFinite(d)) return NO_DATA.slice();
    var x = Math.max(-2, Math.min(2, d / tol));
    for (var i = 0; i < STOPS.length - 1; i++) {
      if (x <= STOPS[i + 1][0]) {
        var a = STOPS[i], b = STOPS[i + 1], f = (x - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + f * (b[1][k] - a[1][k])); });
      }
    }
    return STOPS[STOPS.length - 1][1].slice();
  }

  /* solid, r: from SC.analyzeAll (r rehydrated). opt.origin as in core.js exports. */
  function plyColored(solid, r, opt) {
    var dz = SC.originShift(r, (opt || {}).origin), nv = solid.verts.length, nf = solid.tris.length;
    var head = 'ply\nformat binary_little_endian 1.0\ncomment Gpi Shape Check solid from photos, mm, colour = deviation\n' +
      'element vertex ' + nv + '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n' +
      'element face ' + nf + '\nproperty list uchar int vertex_indices\nend_header\n';
    var hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + nv * 15 + nf * 13);
    new Uint8Array(buf).set(hb);
    var dv = new DataView(buf), o = hb.length, tol = r.tol.profile;
    for (var i = 0; i < nv; i++) {
      var v = solid.verts[i], c = devColor(solid.vdev[i], tol);
      dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2] + dz, true);
      dv.setUint8(o + 12, c[0]); dv.setUint8(o + 13, c[1]); dv.setUint8(o + 14, c[2]); o += 15;
    }
    solid.tris.forEach(function (t) {
      dv.setUint8(o, 3); dv.setInt32(o + 1, t[0], true); dv.setInt32(o + 5, t[1], true); dv.setInt32(o + 9, t[2], true); o += 13;
    });
    return buf;
  }

  return { devColor: devColor, plyColored: plyColored };
})(typeof SC !== 'undefined' ? SC : require('./core.js')); // browser: core.js loads first
if (typeof module !== 'undefined') module.exports = EX3;
