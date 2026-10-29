'use strict';
// Renders a side photo of a dished head with a known outline, for tests.
// Axis vertical at x = cx, tangent line at y = yTan, flange and shell run to the bottom.
const SC = require('../../src/core.js');

const DIN11 = { type: 'din28011', Da: 2000, s: 5, h1: 40, ref: 'inside' };

function renderHead(opt) {
  const o = Object.assign({ w: 640, h: 420, cx: 320.3, yTan: 330.6, mmPerPx: 4, widthScale: 1, bg: 205, obj: 95, noise: 2, stripes: 0, seed: 7, spec: DIN11 }, opt);
  const nom = SC.buildModel(o.spec);
  const prof = [];
  for (let i = 0; i <= 4000; i++) { const e = nom.evalAt((i / 4000) * nom.tKn); prof.push([e[0], e[1]]); }
  // half width (px) at height z (mm): z falls from H to 0 while rho grows to Ro
  function halfWidth(z) {
    if (z > nom.H) return -1;
    if (z <= 0) return (o.widthScale * nom.Ro) / o.mmPerPx;
    let lo = 0, hi = prof.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (prof[m][1] > z) lo = m; else hi = m; }
    const a = prof[lo], b = prof[hi], f = (z - a[1]) / (b[1] - a[1]);
    return (o.widthScale * (a[0] + f * (b[0] - a[0]))) / o.mmPerPx;
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
        if (Math.abs(px - o.cx) <= halfWidth((o.yTan - py) * o.mmPerPx)) inside++;
      }
      const f = inside / (S * S);
      const bg = o.bg + (o.stripes ? o.stripes * (Math.floor(y / 12) % 2 ? 1 : -1) : 0);
      const obj = o.obj + 25 * Math.sin(x / 37); // reflections on the steel
      const v = f * obj + (1 - f) * bg + o.noise * gauss();
      const k = 4 * (y * o.w + x);
      rgba[k] = rgba[k + 1] = rgba[k + 2] = v; rgba[k + 3] = 255;
    }
  }
  return { rgba, w: o.w, h: o.h, truth: (y) => halfWidth((o.yTan - y) * o.mmPerPx), cx: o.cx, nom, yTan: o.yTan, mmPerPx: o.mmPerPx };
}

module.exports = { renderHead, DIN11 };
