/* 3D view of a measured part: solid coloured by deviation, measured points,
   nominal wireframe. Adapted from the pilot v0.1 viewer (three.js r128). */
var V3D = (function () {
  'use strict';
  var three = null;

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
  function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }

  function init(canvas) {
    if (three) return true;
    if (!window.THREE) return false;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 1, 200000);
    camera.up.set(0, 0, 1);
    var controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, canvas) : null;
    if (controls) { controls.enableDamping = true; controls.dampingFactor = 0.12; }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75));
    var dl = new THREE.DirectionalLight(0xffffff, 0.65); camera.add(dl); dl.position.set(0.5, 1, 0.3); scene.add(camera);
    var groups = { points: new THREE.Group(), solid: new THREE.Group(), nominal: new THREE.Group() };
    scene.add(groups.points, groups.solid, groups.nominal);
    three = { renderer: renderer, scene: scene, camera: camera, controls: controls, groups: groups };
    function resize() { var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
    resize();
    // nothing to draw while the 3D view is hidden: saves the phone battery
    (function loop() { requestAnimationFrame(loop); if (canvas.hidden || !canvas.clientWidth) return; if (controls) controls.update(); scene.background = new THREE.Color(cssVar('--viewer')); renderer.render(scene, camera); })();
    return true;
  }

  function clear(g) { while (g.children.length) { var c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); } }

  function fit() {
    if (!three) return;
    var box = new THREE.Box3().expandByObject(three.groups.solid);
    if (box.isEmpty()) return;
    var sph = box.getBoundingSphere(new THREE.Sphere()), d = sph.radius / Math.sin(three.camera.fov * Math.PI / 360) * 1.05;
    three.camera.position.copy(sph.center).addScaledVector(new THREE.Vector3(0.55, -0.75, 0.5).normalize(), d);
    three.camera.near = d / 100; three.camera.far = d * 20; three.camera.updateProjectionMatrix();
    if (three.controls) { three.controls.target.copy(sph.center); three.controls.update(); }
  }

  function show(res, solid) {
    if (!three) return;
    var g = three.groups, tol = res.tol.profile;
    clear(g.points); clear(g.solid); clear(g.nominal);
    var n = res.dev.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      pos[3 * i] = res.q[3 * i]; pos[3 * i + 1] = res.q[3 * i + 1]; pos[3 * i + 2] = res.q[3 * i + 2];
      var c = rgb(EX3.devColor(res.inReg[i] && Math.abs(res.dev[i]) <= res.outlierLim ? res.dev[i] : null, tol));
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    var pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.points.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: Math.max(3, res.spec.Da / 300), vertexColors: true })));
    var nv = solid.verts.length, sp = new Float32Array(nv * 3), sc = new Float32Array(nv * 3);
    for (i = 0; i < nv; i++) {
      sp[3 * i] = solid.verts[i][0]; sp[3 * i + 1] = solid.verts[i][1]; sp[3 * i + 2] = solid.verts[i][2];
      var cc = rgb(EX3.devColor(solid.vdev[i], tol)); sc[3 * i] = cc[0]; sc[3 * i + 1] = cc[1]; sc[3 * i + 2] = cc[2];
    }
    var idx = new Uint32Array(solid.tris.length * 3); solid.tris.forEach(function (t, j) { idx[3 * j] = t[0]; idx[3 * j + 1] = t[1]; idx[3 * j + 2] = t[2]; });
    var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3)); sg.setIndex(new THREE.BufferAttribute(idx, 1)); sg.computeVertexNormals();
    g.solid.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide })));
    var nom = res.nominal, lines = [], nM = 24, nS = 80;
    for (var a = 0; a < nM; a++) { var th = a / nM * 2 * Math.PI; for (var s = 0; s < nS; s++) { var e1 = nom.evalAt(s / nS * nom.tEnd), e2 = nom.evalAt((s + 1) / nS * nom.tEnd); lines.push(e1[0] * Math.cos(th), e1[0] * Math.sin(th), e1[1], e2[0] * Math.cos(th), e2[0] * Math.sin(th), e2[1]); } }
    var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    g.nominal.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--teal-dark')), transparent: true, opacity: 0.45 })));
    fit();
  }

  function setVisible(which, on) { if (three) three.groups[which].visible = on; }

  return { init: init, show: show, fit: fit, setVisible: setVisible };
})();
