# Gpi Shape Check

Measure dished heads and cones with the phone camera, check them against the standard and export the result to STEP or STL for Solid Edge. Built by Gpi Group for incoming inspection, heads welded to the shell and final inspection.

**Status: v0.2.0, proof of concept.** This version only answers the first question: can the camera find the outline of shiny stainless steel reliably? Measuring and checking follow once that is proven on real parts.

## Use it on the phone
1. Open the app link in Chrome on Android.
2. Chrome menu, **Add to home screen** (or **Install app**).
3. Take a photo of a part from the side, square to the part, with background all around the outline.
4. Drag a box around the part if the search picks up other things.
5. Read the verdict and add it to the test log. Try different backgrounds and light, then download the log as CSV.

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
