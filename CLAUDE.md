# CLAUDE.md: Gpi Shape Check

Phone app (PWA) that measures dished heads (DIN 28011, DIN 28013), cones with knuckle and later arbitrary purchased parts with the camera, checks them against nominal and tolerance (DIN, EN 13445-4, Gpi tolerances) and exports STEP, STL and IGES for comparison in Solid Edge. Owner: Jarno Spaan, Gpi Group. Project memory with decisions and open points: `../02 Project Documentation/PROJECT_MEMORY.md` (read it first).

## Hard constraints
- The steel is always shiny stainless. No stickers, markers or spray on the product. A scale bar or calibration board next to the part is fine.
- Measuring principle: silhouette and profile from photos. Depth sensors and texture photogrammetry do not work on shiny stainless.
- All in one app: capture, measure, check, export. No external scan app.
- Everything runs on the phone. No server, no database, no Ridder IQ in this phase (proof of concept, App Foundations F-7.3).

## Structure
- `index.html`: the app shell and all CSS.
- `src/app.js`: edge test screen, UI only. `src/measure.js`: measure screen, UI only. `src/viewer3d.js`: three.js r128 view.
- `src/silhouette.js`: edge finder on photos. No DOM, runs in `src/edge-worker.js` and in node.
- `src/profile.js`: photo outline to (rho, z) in mm and to 3D points for core.js. `src/export3d.js`: coloured PLY for Blender.
- Always call `SC.analyze` with `scaleMode: 'scale'` on photo points: a free scale fit can collapse on sparse points. Apply a tape circumference before, in measure.js.
- `src/core.js`: profile models, best-fit, checks, solid, exports, file parsers. Reused unchanged from pilot v0.1.1. Extend it, do not rewrite it.
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA install and offline cache.
- `tests/`: node built-in test runner, synthetic data only.

## Rules
- Plain browser JavaScript, no build step, no npm dependencies. Match the ES5 style of `core.js` in browser files.
- All paths relative: the app is served from a GitHub Pages subpath.
- New logic goes into a DOM-free module with tests first. Run `npm test` before every commit; keep coverage of `core.js` and `silhouette.js` at 80% or more (`npm run coverage`).
- Version: bump `package.json`, `VERSION` and `RELEASE_NOTES` in `src/app.js` and `CACHE` in `sw.js` together. `tests/version.test.js` enforces this.
- UI text in English. Gpi Group style: teal #00B3A0, Sofia Sans, sharp corners, white Gpi logo in a teal box top left, version in the top bar, full width on wide screens, one column on a phone.
- Write "Gpi Group" and "Ridder IQ" exactly like that. Messages to Jarno in Dutch, without dashes as punctuation.
- Never put real customer or project data in tests or the repo.

## Run
- Tests: `npm test`
- Local: `npm run serve` then http://localhost:8794 (port registered in `C:\Dev\dev-ports.json`). Camera capture through the file input also works over plain http; the service worker only on https or localhost.
