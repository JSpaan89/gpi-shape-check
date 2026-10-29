'use strict';
// From side photos to a measured head: profile per photo, combined into 3D points,
// then the existing core.js best-fit and checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/core.js');
const SIL = require('../src/silhouette.js');
const PRO = require('../src/profile.js');
const { renderHead, DIN11 } = require('./helpers/render-head.js');

const MM = 2.5; // mm per px in the rendered photos
const TOL = { profile: 3, diameter: 4, ovality: 8, height: 5, crownPct: 5, knucklePct: 10, slopeDeg: 1 };
const photo = (o) => renderHead(Object.assign({ w: 1000, h: 330, cx: 500.4, yTan: 250.3, mmPerPx: MM }, o));
const edgesOf = (img) => SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 1 });
function near(a, e, tol, label) { assert.ok(Math.abs(a - e) <= tol, `${label}: ${a} not within ${tol} of ${e}`); }
const check = (res, key) => res.checks.find((c) => c.key === key);

test('ruler scale from two tapped points', () => {
  near(PRO.rulerScale({ x: 100, y: 200 }, { x: 500, y: 500 }, 1000), 2, 1e-12, 'mm per px');
  assert.throws(() => PRO.rulerScale({ x: 1, y: 1 }, { x: 1, y: 1 }, 1000), /ruler/i);
});

test('one photo gives the outline in mm around the axis', () => {
  const img = photo();
  const v = PRO.fromEdges(edgesOf(img), { mmPerPx: MM });
  near(v.axisX, img.cx, 0.1, 'axis position');
  near(v.baseWidthPx * MM, 2000, 1, 'flange width');
  const flange = v.pts.filter((p) => p.z < -(img.yTan + 5) * MM); // rows below the tangent line
  assert.ok(flange.length > 50);
  for (const p of flange) near(p.rho, 1000, 0.6, 'flange radius');
  assert.ok(v.pts.some((p) => p.side === 1) && v.pts.some((p) => p.side === -1));
});

test('a tilted phone is corrected by the fitted axis', () => {
  // shear the found outline by 2 degrees, as if the phone was held slightly skew
  const e = edgesOf(photo()), b = Math.tan(2 * Math.PI / 180);
  const shear = (p) => Object.assign({}, p, { x: p.x + b * p.y });
  const tilted = Object.assign({}, e, { left: e.left.map(shear), right: e.right.map(shear), top: e.top.map(shear) });
  const v = PRO.fromEdges(tilted, { mmPerPx: MM });
  near(v.tilt, b, 2e-3, 'tilt (0.1 degree)');
  // a shear widens the outline by 1/cos; within 1 mm of the true radius after correction
  for (const p of v.pts.filter((q) => q.z < -260 * MM)) near(p.rho, 1000, 1.5, 'radius after tilt');
});

test('scale falls back to the nominal diameter without a ruler', () => {
  const v = PRO.fromEdges(edgesOf(photo()), { Da: 2000 });
  near(v.mmPerPx, MM, 0.005, 'mm per px from Da');
  assert.equal(v.scaleSource, 'nominal');
});

test('four photos of a round head pass through core.js with the right dimensions', () => {
  const views = [0, 1, 2, 3].map(() => PRO.fromEdges(edgesOf(photo()), { mmPerPx: MM }));
  const res = SC.analyze(PRO.toPoints(views), { spec: DIN11, tol: TOL, scaleMode: 'scale', unitFactor: 1 });
  near(check(res, 'diameter').measured, 2000, 4, 'diameter');
  near(check(res, 'height').measured, SC.buildModel(DIN11).H, 4, 'height');
  near(check(res, 'crown').measured, 2000, 60, 'crown radius');
  near(check(res, 'knuckle').measured, 200, 25, 'knuckle radius');
  assert.ok(check(res, 'ovality').measured < 4, `ovality ${check(res, 'ovality').measured}`);
});

test('an oval head shows up as out of roundness', () => {
  // the photo at 90 degrees sees a 10 mm wider head
  const scales = [1, 1.0025, 1.005, 1.0025];
  const views = scales.map((s) => PRO.fromEdges(edgesOf(photo({ widthScale: s })), { mmPerPx: MM }));
  const res = SC.analyze(PRO.toPoints(views), { spec: DIN11, tol: TOL, scaleMode: 'scale', unitFactor: 1 });
  near(check(res, 'ovality').measured, 10, 3.5, 'ovality');
});

test('a photo without an outline is refused with a clear message', () => {
  const w = 200, h = 150, rgba = new Uint8ClampedArray(w * h * 4).fill(180);
  const e = SIL.analyzeImage(SIL.toGray(rgba, w, h), w, h, {});
  assert.throws(() => PRO.fromEdges(e, { mmPerPx: 1 }), /outline/i);
  assert.throws(() => PRO.toPoints([]), /photo/i);
});
