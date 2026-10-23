// 05 Technical details: the pipeline figure, the robot case of the hotel room with one live cell per stage.
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {loadStory, partGeometry, proxyColor, PALETTE} from './world.js';
import {videoPlayback} from './media.js?v=20261023-mobile-all-2';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── the pipeline ──
const pipe = $('#pipeline');
if (pipe) {
  const row = $('.pipe-row', pipe), cells = $$('.pipe-cell', pipe), links = $$('.pipe-link', pipe);
  const proxy = $('.proxy video', pipe), out = $('.video video', pipe), lines = $$('.pipe-code [data-a]', pipe);
  if (out.dataset.poster) out.poster = out.dataset.poster;
  const playback = videoPlayback([proxy.parentElement, out.parentElement], () => [out, proxy]);
  const inView = new Set();
  const mediaObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.intersectionRatio >= .5) inView.add(e.target); else inView.delete(e.target);
    }
    if (inView.size) playback.play();
    else playback.pause();
  }, {threshold: [0, .5]});
  [proxy, out].forEach(v => mediaObserver.observe(v));
  let on = -1, pinned = null, visible = false, timer = 0;
  // a spotlight walks the row, resting on each cell; the pointer holds it on a cell
  const light = k => {
    if (k === on) return;
    on = k;
    row.dataset.on = k;
    cells.forEach((c, i) => c.classList.toggle('on', i === k));
    links.forEach((l, i) => { l.classList.remove('on'); if (i === k - 1) { void l.offsetWidth; l.classList.add('on'); } });
  };
  const step = () => { if (pinned === null) light((on + 1) % cells.length); timer = setTimeout(step, 3600); };
  cells.forEach((c, i) => {
    c.addEventListener('pointerenter', () => { pinned = i; light(i); });
    c.addEventListener('pointerleave', () => pinned = null);
  });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    clearTimeout(timer);
    if (visible) { light(on < 0 ? 0 : on); if (!reduced) timer = setTimeout(step, 2200); }
  }, {threshold: .4}).observe(pipe);

  // proxy and video run together; the program's live line, the playhead along both videos, and the robot and the camera in the
  // world follow the video
  let marker = null;
  const heads = $$('.pipe-time', pipe);
  const tick = () => {
    if (visible) {
      const t = out.currentTime;
      if (!out.paused && !out.seeking && !proxy.seeking && proxy.readyState >= 2 && Math.abs(proxy.currentTime - t) > .09) proxy.currentTime = t;
      for (const l of lines) l.classList.toggle('on', t >= +l.dataset.a && t < +l.dataset.b);
      for (const h of heads) h.style.setProperty('--k', out.duration ? (t / out.duration).toFixed(4) : 0);
      marker?.(t);
    }
    requestAnimationFrame(tick);
  };
  tick();

  // the world: the agent's boxes in the proxy palette, the robot and its bag as the simulation moved them, and the camera that
  // filmed them riding its path
  const canvas = $('#pipeCanvas', pipe);
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    world().catch(e => console.error(e));
  }, {rootMargin: '400px'});
  io.observe(canvas);
  async function world() {
    const [data, buf] = await Promise.all([loadStory(), fetch('story/g1-anim.bin').then(r => r.arrayBuffer())]);
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color('#fbfaf7'), 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 4 / 3, .05, 100);
    camera.up.set(0, 0, 1);
    const focus = new THREE.Vector3(-.1, 6.6, .55);   // between the cabinet the bag starts on and the bed it ends on
    camera.position.copy(focus).add(new THREE.Vector3(-4.2, 2.4, 5.6));   // across the bed toward the cabinet: nothing stands between it and the robot
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(focus);
    controls.enableZoom = controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = .55;
    controls.minPolarAngle = .55;
    controls.maxPolarAngle = 1.25;
    controls.update();
    const ink = new THREE.Color('#161615');
    for (const p of data.geometry) {
      if (p.layer === 'ceiling') continue;
      const g = partGeometry(p), color = new THREE.Color(proxyColor(p));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({color: p.layer === 'wall' ? ink : color.clone().multiplyScalar(.72),
        transparent: true, opacity: p.layer === 'wall' ? .28 : 1}));
      scene.add(edges);
      if (p.layer === 'wall') continue;
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, transparent: p.layer === 'floor', opacity: p.layer === 'floor' ? .5 : 1, side: THREE.DoubleSide,
        depthWrite: p.layer !== 'floor', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1})));
    }
    // the robot and its bag: rigid parts with a pose per frame (story/g1-anim.bin, the hero's own), in the proxy's flat colours
    const g1 = data.story.paths.g1, np = g1.parts.length;
    const nv = g1.parts.reduce((a, p) => a + p.vertices, 0), nt = g1.parts.reduce((a, p) => a + p.triangles, 0);
    const V = new Float32Array(buf, 0, nv * 3), T = new Uint32Array(buf, nv * 12, nt * 3), P = new Float32Array(buf, (nv + nt) * 12, g1.frames * np * 7);
    const parts = [];
    let vo = 0, to = 0;
    for (const p of g1.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(V.slice(vo * 3, (vo + p.vertices) * 3), 3));
      g.setIndex(new THREE.BufferAttribute(T.slice(to * 3, (to + p.triangles) * 3), 1));
      const color = new THREE.Color(p.kind === 'robot' ? PALETTE.new_object : '#ffffff');
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({color: color.clone().multiplyScalar(.7)})));
      scene.add(m);
      parts.push(m);
      vo += p.vertices;
      to += p.triangles;
    }
    // the camera's path, and a small camera that rides it in time with the video
    const pts = g1.poses.map(M => new THREE.Vector3(M[0][3], M[1][3], M[2][3]));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color: ink, transparent: true, opacity: .55})));
    const cam = new THREE.Group();
    const K = g1.K, w = 640, h = 480, d = .32;
    const c = (u, v) => new THREE.Vector3((u - K[0][2]) / K[0][0] * d, (v - K[1][2]) / K[1][1] * d, d);
    const cs = [c(0, 0), c(w, 0), c(w, h), c(0, h)], o = new THREE.Vector3();
    const seg = [];
    for (let k = 0; k < 4; k++) seg.push(o, cs[k], cs[k], cs[(k + 1) % 4]);
    cam.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({color: new THREE.Color('#f42738')})));
    cam.add(new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 8), new THREE.MeshBasicMaterial({color: new THREE.Color('#f42738')})));
    cam.matrixAutoUpdate = false;
    scene.add(cam);
    const flip = new THREE.Matrix4().makeScale(1, -1, -1);
    marker = t => {
      const i = Math.min(g1.frames - 1, Math.max(0, Math.round(t * 24)));
      cam.matrix.set(...g1.poses[i].flat()).multiply(flip);
      parts.forEach((m, k) => {
        const q = (i * np + k) * 7;
        m.position.set(P[q], P[q + 1], P[q + 2]);
        m.quaternion.set(P[q + 3], P[q + 4], P[q + 5], P[q + 6]);
      });
    };
    marker(0);
    new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }).observe(canvas);
    renderer.setAnimationLoop(() => {
      if (!visible) return;
      controls.update();
      renderer.render(scene, camera);
    });
  }
}
