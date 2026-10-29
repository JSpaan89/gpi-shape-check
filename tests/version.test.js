'use strict';
// One version everywhere: package.json, the top bar (app.js) and the service worker cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('version is the same in package.json, app.js and sw.js', () => {
  const v = JSON.parse(read('package.json')).version.replace(/\./g, '\\.');
  assert.match(read('src/app.js'), new RegExp(`var VERSION = 'v${v}'`));
  assert.match(read('sw.js'), new RegExp(`var CACHE = 'shapecheck-v${v}'`));
  assert.match(read('src/app.js'), new RegExp(`\\['v${v}', \\[`), 'release notes describe this version');
});

test('every file the service worker caches exists', () => {
  const sw = read('sw.js');
  const list = JSON.parse(sw.slice(sw.indexOf('['), sw.indexOf('];') + 1).replace(/'/g, '"'));
  for (const f of list) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
});
