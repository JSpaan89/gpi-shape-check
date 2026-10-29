# Gpi Shape Check

Measure dished heads and cones with the phone camera, check them against the standard and export the result to STEP or STL for Solid Edge. Built by Gpi Group for incoming inspection, heads welded to the shell and final inspection.

**Status: v0.3.0, proof of concept.** Live: https://jspaan89.github.io/gpi-shape-check/

## Use it on the phone
1. Open the app link in Chrome on Android, menu **Add to home screen** (or **Install app**).
2. **Measure:** enter the part (DIN 28011, DIN 28013 or cone), walk half a turn around it and take 4 photos, one every 45°, in that order. Scale: tape circumference (best), a long ruler upright next to the part with its ends tapped on each photo, or none (shape only). Press Measure: checks, a 3D view coloured by deviation, and exports (PLY for Blender, STEP solid, STL, STEP points, CSV).
3. **Edge test:** one photo, see whether the steel outline is found against your background; keep a log to compare backgrounds and finishes.

## How it measures
Shiny stainless defeats depth sensors and texture photogrammetry, and markers or spray on the product are not allowed. Shape Check therefore uses the **silhouette**: the outline of the part against the background. For a head or cone, which is round, side photos from several directions give the profile and the diameter in each direction, so also the out of roundness. The geometry, best fit, checks and exports in `src/core.js` come from pilot v0.1.1 and are covered by tests.

Planned next steps: lens calibration and scale, profile from several photos into `core.js` for the checks, guided capture, exports. Later: comparing purchased parts with the drawing or 3D model.

## Develop
No build step and no dependencies. Node 20 or newer.

```bash
npm test
```

```bash
npm run serve
```

Then open http://localhost:8794. See `CLAUDE.md` for the rules of this repository.

## Hosting
Proof of concept on GitHub Pages (Gpi App Foundations F-7.3: no company data, no production links). For use by QC the app moves to Azure DevOps (team Gpi Apps, F-7.4) with Entra sign-in; that needs an ICT handoff.
