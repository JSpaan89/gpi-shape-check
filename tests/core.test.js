'use strict';
// core.js is reused unchanged from pilot v0.1.1. These tests pin its behaviour
// with synthetic data, so later changes to the app cannot silently break it.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/core.js');

const DIN11 = { type: 'din28011', Da: 2000, s: 5, h1: 40, ref: 'inside' };
const CONE = { type: 'cone', Da: 1600, s: 6, h1: 40, ref: 'inside', r: 160, beta: 30, dTop: 300 };
const TOL = { profile: 3, diameter: 4, ovality: 8, height: 5, crownPct: 5, knucklePct: 10, slopeDeg: 1 };

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} not within ${tol} of ${expected}`);
}
function check(res, key) { return res.checks.find((c) => c.key === key); }

test('nominal radii follow DIN 28011 and DIN 28013', () => {
  assert.deepEqual(SC.nominalRadii({ type: 'din28011', Da: 2000 }), { R: 2000, r: 200 });
  const k = SC.nominalRadii({ type: 'din28013', Da: 2000 });
  near(k.R, 1600, 1e-9, 'R');
  near(k.r, 308, 1e-9, 'r');
});

test('invalid dimensions give no model', () => {
  assert.equal(SC.buildModel({ type: 'tori', Da: 1000, R: 400, r: 600, h1: 40 }), null);
  assert.equal(SC.buildModel({ type: 'cone', Da: 1000, r: 50, beta: 95, dTop: 0, h1: 40 }), null);
});

for (const [name, spec] of [['torispherical', DIN11], ['cone', CONE]]) {
  test(`${name} profile is continuous and every profile point has zero distance`, () => {
    const m = SC.buildModel(spec);
    const o = { d: 0, t: 0 };
    near(m.evalAt(m.tKn)[0], m.Ro, 1e-6, 'radius at tangent line');
    near(m.evalAt(m.tKn)[1], 0, 1e-6, 'height at tangent line');
    near(m.evalAt(m.tEnd)[1], -spec.h1, 1e-6, 'flange end');
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * m.tEnd;
      const e = m.evalAt(t);
      m.dist(e[0], e[1], o);
      near(o.d, 0, 1e-6, `distance at t=${t.toFixed(1)}`);
      near(o.t, t, 1e-3, `arc length at t=${t.toFixed(1)}`);
    }
  });
}

test('best-fit on a synthetic DIN 28011 scan recovers the real dimensions', () => {
  const pts = SC.sampleScan(DIN11, { n: 20000 });
  const res = SC.analyze(pts, { spec: DIN11, tol: TOL, scaleMode: 'scale' });
  const nom = SC.buildModel(DIN11);
  assert.equal(res.unitFactor, 1000, 'sample is stored in metres');
  near(check(res, 'diameter').measured, 2000, 3, 'diameter');
  near(check(res, 'height').measured, nom.H, 3, 'height');
  near(check(res, 'crown').measured, 2000, 2000 * 0.01, 'crown radius');
  near(check(res, 'knuckle').measured, 200, 200 * 0.05, 'knuckle radius');
  // The sample has 4 mm cos(2 theta) ovality at the rim: about 16 mm Dmax - Dmin
  near(check(res, 'ovality').measured, 16, 4, 'ovality');
  assert.ok(res.coverage > 95, 'full circumference covered');
  assert.ok(res.stats.nOutliers > 0, 'scan spikes are recognised as stray points');
});

test('best-fit on a synthetic cone recovers the slope', () => {
  const pts = SC.sampleScan(CONE, { n: 20000 });
  const res = SC.analyze(pts, { spec: CONE, tol: TOL, scaleMode: 'scale' });
  near(check(res, 'slope').measured, 30, 0.5, 'cone slope');
  near(check(res, 'diameter').measured, 1600, 3, 'diameter');
});

test('circumference scale mode takes the diameter from the tape measurement', () => {
  const pts = SC.sampleScan(DIN11, { n: 12000 });
  const res = SC.analyze(pts, { spec: DIN11, tol: TOL, scaleMode: 'circ', circumference: Math.PI * 2003 });
  const d = check(res, 'diameter');
  near(d.measured, 2003, 1e-6, 'diameter from circumference');
  assert.equal(d.status, 'pass');
});

test('a sparse scan with few flange points still gives the right diameter', () => {
  // 3000 points leave fewer than 300 in the flange band, so the knuckle start is used
  const pts = SC.sampleScan(DIN11, { n: 3000 });
  const res = SC.analyze(pts, { spec: DIN11, tol: TOL, scaleMode: 'scale' });
  near(check(res, 'diameter').measured, 2000, 4, 'diameter from knuckle start');
});

test('unknown scale leaves diameter and height unchecked', () => {
  const pts = SC.sampleScan(DIN11, { n: 12000 });
  const res = SC.analyze(pts, { spec: DIN11, tol: TOL, scaleMode: 'free' });
  assert.equal(check(res, 'diameter').status, 'na');
  assert.equal(check(res, 'height').status, 'na');
});

test('solid from the scan is a closed shell with positive volume', () => {
  const { res, solid } = SC.analyzeAll(SC.sampleScan(DIN11, { n: 12000 }), { spec: DIN11, tol: TOL, scaleMode: 'scale' });
  SC.rehydrate(res);
  const edges = new Map();
  for (const t of solid.tris) {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of edges) assert.equal(count, 2, `edge ${key} is shared by ${count} triangles`);
  // Shell volume is close to wall thickness x surface of revolution of the profile
  const nom = SC.buildModel(DIN11);
  let area = 0;
  for (let i = 0, steps = 2000; i < steps; i++) area += 2 * Math.PI * nom.evalAt((i + 0.5) / steps * nom.tEnd)[0] * nom.tEnd / steps;
  near(solid.volume / (area * DIN11.s), 1, 0.1, 'volume ratio');
});

test('exports are well-formed STEP, STL, IGES and CSV', () => {
  const { res, solid } = SC.analyzeAll(SC.sampleScan(DIN11, { n: 8000 }), { spec: DIN11, tol: TOL, scaleMode: 'scale' });
  SC.rehydrate(res);
  const opt = { origin: 'tangent', part: 'Test head', name: 'test' };

  const stepSolid = SC.stepSolid(solid, res, opt);
  assert.match(stepSolid, /^ISO-10303-21;/);
  assert.match(stepSolid, /END-ISO-10303-21;\n$/);
  assert.equal((stepSolid.match(/=FACE_SURFACE\(/g) || []).length, solid.tris.length);
  assert.match(stepSolid, /FACETED_BREP\('scan solid'/);

  const stepPts = SC.stepPointCloud(res, opt);
  assert.match(stepPts, /GEOMETRIC_CURVE_SET\('scan points'/);

  const stl = SC.stlBinary(solid, res, opt);
  assert.equal(stl.byteLength, 84 + 50 * solid.tris.length);
  const back = SC.parseFile('x.stl', stl);
  assert.equal(back.length, solid.tris.length * 9);

  const iges = SC.igesPoints(res, opt).trimEnd().split('\n');
  for (const line of iges) assert.equal(line.length, 80, `IGES line is 80 columns: ${line}`);
  assert.match(iges[iges.length - 1], /T {6}1$/);

  const csv = SC.csvDeviations(res, opt).split('\n');
  assert.equal(csv[0], 'x_mm;y_mm;z_mm;deviation_mm;meridian_mm;in_region');
  assert.equal(csv.length, res.dev.length + 1);
});

test('origin shift moves exports to flange or apex', () => {
  const res = { spec: { h1: 40 }, nominal: { H: 390 } };
  assert.equal(SC.originShift(res, 'tangent'), 0);
  assert.equal(SC.originShift(res, 'flange'), 40);
  assert.equal(SC.originShift(res, 'apex'), -390);
});

test('parsers read XYZ, OBJ and ASCII PLY, and reject tiny files', () => {
  const n = 300;
  const rows = Array.from({ length: n }, (_, i) => [i, i * 2, i * 3]);
  const enc = (s) => new TextEncoder().encode(s).buffer;

  const xyz = SC.parseFile('a.xyz', enc(rows.map((r) => r.join(' ')).join('\n')));
  assert.equal(xyz.length, n * 3);
  assert.equal(xyz[3 * 10 + 2], 30);

  const semi = SC.parseFile('a.csv', enc(rows.map((r) => r.map((v) => `${v},5`).join(';')).join('\n')));
  assert.equal(semi[0], 0.5);

  const obj = SC.parseFile('a.obj', enc(rows.map((r) => `v ${r.join(' ')}`).join('\n')));
  assert.equal(obj.length, n * 3);

  const ply = SC.parseFile('a.ply', enc(`ply\nformat ascii 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${rows.map((r) => r.join(' ')).join('\n')}\n`));
  assert.equal(ply[3 * 299 + 1], 598);

  assert.throws(() => SC.parseFile('a.xyz', enc('1 2 3\n4 5 6')), /Only 2 points/);
});

test('binary PLY is read', () => {
  const n = 250;
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
  const hb = new TextEncoder().encode(head);
  const buf = new ArrayBuffer(hb.length + n * 12);
  new Uint8Array(buf).set(hb);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) dv.setFloat32(hb.length + i * 12 + k * 4, i + k, true);
  const pts = SC.parseFile('b.ply', buf);
  assert.equal(pts.length, n * 3);
  assert.equal(pts[3 * 7 + 2], 9);
});

test('auto unit detects metres and millimetres', () => {
  const m = SC.sampleScan(DIN11, { n: 2000 });
  assert.equal(SC.autoUnit(m, 2000).factor, 1000);
  const mm = Float32Array.from(m, (v) => v * 1000);
  assert.equal(SC.autoUnit(mm, 2000).factor, 1);
});
