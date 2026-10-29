'use strict';
// Silhouette edge finder, tested on rendered photos of a DIN 28011 head with a
// known outline, so every detected edge can be compared with the truth.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/core.js');
const SIL = require('../src/silhouette.js');

const MM_PER_PX = 4;

/* Side view of a head: axis vertical at x = cx, tangent line at y = yTan,
   straight flange plus shell running to the bottom of the image. */
function renderHead(opt) {
  const o = Object.assign({ w: 640, h: 420, cx: 320.3, yTan: 330.6, bg: 205, obj: 95, noise: 2, stripes: 0, seed: 7 }, opt);
  const nom = SC.buildModel({ type: 'din28011', Da: 2000, s: 5, h1: 40, ref: 'inside' });
  const prof = [];
  for (let i = 0; i <= 4000; i++) { const e = nom.evalAt((i / 4000) * nom.tKn); prof.push([e[0], e[1]]); }
  // half width (px) at height z (mm): z falls from H to 0 while rho grows to Ro
  function halfWidth(z) {
    if (z > nom.H) return -1;
    if (z <= 0) return nom.Ro / MM_PER_PX;
    let lo = 0, hi = prof.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (prof[m][1] > z) lo = m; else hi = m; }
    const a = prof[lo], b = prof[hi], f = (z - a[1]) / (b[1] - a[1]);
    return (a[0] + f * (b[0] - a[0])) / MM_PER_PX;
  }
  let r = o.seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const rgba = new Uint8ClampedArray(o.w * o.h * 4), S = 4;
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      let inside = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x - 0.5 + (sx + 0.5) / S, py = y - 0.5 + (sy + 0.5) / S;
        if (Math.abs(px - o.cx) <= halfWidth((o.yTan - py) * MM_PER_PX)) inside++;
      }
      const f = inside / (S * S);
      const bg = o.bg + (o.stripes ? o.stripes * (Math.floor(y / 12) % 2 ? 1 : -1) : 0);
      const obj = o.obj + 25 * Math.sin(x / 37); // reflections on the steel
      const v = f * obj + (1 - f) * bg + o.noise * gauss();
      const k = 4 * (y * o.w + x);
      rgba[k] = rgba[k + 1] = rgba[k + 2] = v; rgba[k + 3] = 255;
    }
  }
  return { rgba, w: o.w, h: o.h, truth: (y) => halfWidth((o.yTan - y) * MM_PER_PX), cx: o.cx, nom, yTan: o.yTan };
}

function topTruth(img, x) {
  // highest y where the half width at that row still reaches column x
  let lo = 0, hi = img.yTan;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (img.truth(m) >= Math.abs(x - img.cx)) hi = m; else lo = m; }
  return hi;
}

test('toGray uses Rec. 601 luma', () => {
  const g = SIL.toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
  assert.ok(Math.abs(g[0] - 76.245) < 1e-3 && Math.abs(g[1] - 149.685) < 1e-3 && Math.abs(g[2] - 29.07) < 1e-3);
});

// Error measured normal to the outline: on a slanted edge only that part changes the shape
function normalError(dx, slope) { return Math.abs(dx) / Math.sqrt(1 + slope * slope); }

test('left, right and top edges land within a quarter pixel of the true outline', () => {
  const img = renderHead();
  const res = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 1 });
  const crownTop = img.yTan - img.nom.H / MM_PER_PX;
  const sideSlope = (y) => img.truth(y + 0.5) - img.truth(y - 0.5);
  // rows below the tangent line all count; on the flat crown the column scan takes over
  assert.ok(res.left.length > 100, `left edges found: ${res.left.length}`);
  assert.ok(res.left.every((p) => p.y - crownTop > 10), 'flat crown is left to the column scan');
  for (const p of res.left) {
    if (p.y - crownTop < 3) continue; // very top: the side scan grazes the crown
    const e = normalError(p.x - (img.cx - img.truth(p.y)), sideSlope(p.y));
    assert.ok(e < 0.25, `left edge at y=${p.y}: normal error ${e.toFixed(3)} px`);
  }
  for (const p of res.right) {
    if (p.y - crownTop < 3) continue;
    const e = normalError(p.x - (img.cx + img.truth(p.y)), sideSlope(p.y));
    assert.ok(e < 0.25, `right edge at y=${p.y}: normal error ${e.toFixed(3)} px`);
  }
  const central = res.top.filter((p) => Math.abs(p.x - img.cx) < 0.6 * img.nom.Ro / MM_PER_PX);
  assert.ok(central.length > 250, `top edges found: ${central.length}`);
  for (const p of central) {
    const e = normalError(p.y - topTruth(img, p.x), topTruth(img, p.x + 0.5) - topTruth(img, p.x - 0.5));
    assert.ok(e < 0.25, `top edge at x=${p.x}: normal error ${e.toFixed(3)} px`);
  }
});

test('summary reports full coverage, small scatter and high contrast on a clean photo', () => {
  const img = renderHead();
  const s = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 2 }).summary;
  assert.ok(s.sides.coverage > 0.95, `side coverage ${s.sides.coverage}`);
  assert.ok(s.sides.sigma < 0.2, `side scatter ${s.sides.sigma}`);
  assert.ok(s.contrast > 10, `contrast ${s.contrast}`);
  assert.equal(s.verdict, 'usable');
  // flange width at the bottom equals the outside diameter in pixels
  assert.ok(Math.abs(s.baseWidthPx - 2 * img.nom.Ro / MM_PER_PX) < 0.5, `base width ${s.baseWidthPx}`);
});

test('a region of interest limits the search', () => {
  const img = renderHead();
  const roi = { x0: 0, y0: 340, x1: img.w - 1, y1: 400 };
  const res = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 1, roi });
  assert.ok(res.left.every((p) => p.y >= 340 && p.y <= 400));
  assert.equal(res.left.length, 61, 'one edge per row inside the region');
});

test('horizontal stripes in the background do not disturb the side edges', () => {
  const img = renderHead({ stripes: 20 });
  const res = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 2 });
  assert.ok(res.summary.sides.coverage > 0.95);
  assert.ok(res.summary.sides.sigma < 0.25, `side scatter ${res.summary.sides.sigma}`);
});

test('low contrast and heavy noise is reported as not usable', () => {
  const img = renderHead({ obj: 200, noise: 12 });
  const s = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 2 }).summary;
  assert.notEqual(s.verdict, 'usable');
});

test('an empty photo finds nothing and says so', () => {
  const w = 200, h = 150, rgba = new Uint8ClampedArray(w * h * 4).fill(180);
  const s = SIL.analyzeImage(SIL.toGray(rgba, w, h), w, h, {}).summary;
  assert.equal(s.sides.coverage, 0);
  assert.equal(s.verdict, 'not usable');
  assert.equal(s.baseWidthPx, null);
});

test('scatter is robust: a few wild edge points do not inflate sigma', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ y: i, x: 100 + 0.01 * i }));
  pts[50].x += 40; pts[120].x -= 25;
  const q = SIL.edgeScatter(pts, 'x', 'y');
  assert.ok(q.sigma < 0.05, `sigma ${q.sigma}`);
  assert.equal(q.outliers, 2);
});

test('scatter sees noise on a sloped edge too', () => {
  let r = 99;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // slope 0.5 px per row sampled every 6 rows: the series is monotonic, noise sigma 1 px
  const pts = Array.from({ length: 300 }, (_, i) => ({ y: 6 * i, x: 100 + 3 * i + gauss() }));
  const q = SIL.edgeScatter(pts, 'x', 'y');
  assert.ok(q.sigma > 0.8 && q.sigma < 1.6, `sigma ${q.sigma}`);
});

test('scatter of a smooth curved edge stays small', () => {
  // circle of radius 1000 px sampled every 6 px: curvature alone must not look like noise
  const pts = Array.from({ length: 120 }, (_, i) => { const y = 6 * i; return { y, x: 1000 - Math.sqrt(1000 * 1000 - (y - 360) * (y - 360)) }; });
  assert.ok(SIL.edgeScatter(pts, 'x', 'y').sigma < 0.1);
});

test('gray conversion can fill a byte array to save memory', () => {
  const out = SIL.toGray(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1, new Uint8ClampedArray(1));
  assert.ok(out instanceof Uint8ClampedArray);
  assert.equal(out[0], 18);
});

test('verdict needs the top edge as well as the sides', () => {
  const img = renderHead();
  const roi = { x0: 0, y0: 300, x1: img.w - 1, y1: img.h - 1 }; // box below the crown: no top edge
  const s = SIL.analyzeImage(SIL.toGray(img.rgba, img.w, img.h), img.w, img.h, { step: 2, roi }).summary;
  assert.equal(s.verdict, 'doubtful');
});
