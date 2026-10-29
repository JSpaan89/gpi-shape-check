'use strict';
// Coloured PLY for Blender: vertex colours show the deviation from nominal.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/core.js');
const EX = require('../src/export3d.js');

const DIN11 = { type: 'din28011', Da: 2000, s: 5, h1: 40, ref: 'inside' };
const TOL = { profile: 3, diameter: 4, ovality: 8, height: 5, crownPct: 5, knucklePct: 10, slopeDeg: 1 };

test('deviation colours: green on nominal, red outside, blue inside, grey for no data', () => {
  assert.deepEqual(EX.devColor(0, 3), [59, 178, 115]);
  assert.deepEqual(EX.devColor(9, 3), [215, 38, 61]);
  assert.deepEqual(EX.devColor(-9, 3), [43, 89, 195]);
  assert.deepEqual(EX.devColor(null, 3), [184, 189, 191]);
});

test('PLY has a valid header, every vertex and every face, in mm', () => {
  const { res, solid } = SC.analyzeAll(SC.sampleScan(DIN11, { n: 8000 }), { spec: DIN11, tol: TOL, scaleMode: 'scale' });
  SC.rehydrate(res);
  const buf = EX.plyColored(solid, res, { origin: 'tangent' });
  const bytes = Buffer.from(new Uint8Array(buf));
  const headEnd = bytes.indexOf('end_header\n') + 'end_header\n'.length;
  const head = bytes.subarray(0, headEnd).toString('ascii');
  assert.match(head, /^ply\nformat binary_little_endian 1\.0\n/);
  assert.match(head, new RegExp(`element vertex ${solid.verts.length}\n`));
  assert.match(head, new RegExp(`element face ${solid.tris.length}\n`));
  assert.match(head, /property uchar red\nproperty uchar green\nproperty uchar blue\n/);
  assert.equal(buf.byteLength, headEnd + solid.verts.length * 15 + solid.tris.length * 13);
  const dv = new DataView(buf, headEnd);
  assert.ok(Math.abs(dv.getFloat32(0, true) - solid.verts[0][0]) < 1e-3);
  // core.js reads it back as a point set
  assert.equal(SC.parseFile('x.ply', buf).length, solid.verts.length * 3);
});
