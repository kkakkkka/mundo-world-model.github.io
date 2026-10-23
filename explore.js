// Spatial Exploration: each .explorer plays the scenes and camera paths of its data-cases file in turn, each case easing into the next.
// The inputs (context photos, camera path) sit in 3D; the output video is the subject, tied by a beam to the camera that renders it.
// data-mode sets how the input is drawn: "cameras" (1.1) only the context photos on their cameras; "lift" (1.2) the one input photo
// lifts off its image plane into a point cloud; by default (1.4) the point cloud, with the context re-picked per window
// (the window in use is lit, the rest of the path's photos stay faint).
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {prepareVideo, seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';
import {INK, INPUT, OUTPUT, PAPER, ease, whenNear, loadCloud, cloudPoints, cutWalls, poseMatrix, frustum, frustumSolid, imagePlane,
  pathTube, dashedLine, corners, clock, cooperativeZoom} from './space.js';

for (const root of document.querySelectorAll('.explorer')) whenNear(root, () => init(root));

const ON = [.7, .92], OFF = [0, 0], DIM = [.2, .3];
// ms from a new 1.2 world appearing: its photo shows (LIFT_HOLD), lifts into points (LIFT_RISE) while the view eases out, and the
// video starts at LIFT
const LIFT_HOLD = 450, LIFT_RISE = 1150, LIFT = 1600;

async function init(root) {
  const mode = root.dataset.mode || 'points', $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const stage = $('.ex-stage'), canvas = $('.ex-stage canvas'), screen = $('.ex-screen'), thumbs = $('.ex-thumbs'), list = $('.ex-cases');
  const strip = $('.ex-strip'), reset = $('.ex-reset'), peekBox = $('.ex-peek'), peekImg = $('.ex-peek img');
  // photo and output-camera sizes, in scene units: small photos, a larger output camera
  const REF = mode === 'cameras' ? .55 : .32, HEAD = {cameras: .8, lift: .45}[mode] ?? .55;
  const beam = $('.ex-beam'), beamFill = $('.ex-beam .fill'), beamEdge = $('.ex-beam .edge'), grad = $('linearGradient');
  const proxyBox = $('.ex-proxy'), proxy = $('.ex-proxy video'), proxyBtn = $('[data-ex-proxy]');
  const credit = $('.ex-credit');

  // scenes in page order, each with its paths; playback runs through all of them and wraps around
  const groups = await fetch(root.dataset.cases).then(r => r.json());
  const cases = [];
  list.replaceChildren(...groups.map(g => {
    const el = document.createElement('div'), own = g.items.map((it, k) => ({...it, el, k}));
    el.className = 'ex-case';
    el.innerHTML = `<button class="ex-scene" aria-label="${g.name}"><img src="${g.thumb}" alt="" loading="lazy"><span class="ex-bar"></span></button><span class="ex-dots"></span>`;
    el.bar = el.querySelector('.ex-bar');
    el.credit = g.credit;
    el.querySelector('.ex-dots').replaceChildren(...own.map(c => {
      const b = document.createElement('button');
      b.setAttribute('aria-label', `${g.name}, path ${c.k + 1}`);
      b.addEventListener('click', () => go(cases.indexOf(c)));
      return b;
    }));
    el.querySelector('.ex-scene').addEventListener('click', () => cases[at]?.el !== el && go(cases.indexOf(own[0])));
    cases.push(...own);
    return el;
  }));
  if (cases.length < 2) strip.remove();   // a single case needs no picker
  // the strip scrolls sideways; arrows and faded edges show where there is more
  const edges = () => {
    strip.classList.toggle('more-left', list.scrollLeft > 2);
    strip.classList.toggle('more-right', list.scrollLeft < list.scrollWidth - list.clientWidth - 2);
  };
  list.addEventListener('scroll', edges, {passive: true});
  new ResizeObserver(edges).observe(list);
  $$('.ex-arrow').forEach(b => b.addEventListener('click', () =>
    list.scrollBy({left: (b.classList.contains('next') ? .8 : -.8) * list.clientWidth, behavior: 'smooth'})));

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(PAPER, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .03, 400);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  const spin = mode !== 'lift';   // a one-photo world is seen from near its photo, not orbited
  Object.assign(controls, {enableDamping: true, autoRotate: spin, autoRotateSpeed: .35, minDistance: .6, maxDistance: 24, enablePan: false});
  cooperativeZoom(stage, controls);
  // once the visitor moves the view: no auto-rotation for a while, a reset button, and the case plays again instead of moving on
  let idle, touched = -1e9;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idle); touched = performance.now(); reset.classList.add('on'); });
  controls.addEventListener('end', () => { idle = setTimeout(() => controls.autoRotate = spin, 6000); });

  // two output decks, so the next case can load behind the current one and cross-fade in
  const decks = $$('.ex-out').map(v => ({v, time: clock(v)}));
  const loader = new THREE.TextureLoader(), cache = {};
  let live = 0, at = -1, world = null, token = 0, visible = false, inView = false, fly = null, hover = -1, shift = 0, first = true;
  const playback = videoPlayback(screen, () => proxyBox.classList.contains('on') ? [decks[live].v, proxy] : [decks[live].v]);
  const load = id => cache[id] ??= loadCloud(id, mode !== 'cameras');
  const dispose = obj => obj.traverse(o => {
    o.geometry?.dispose();
    if (o.material) { o.material.map?.dispose(); o.material.alphaMap?.dispose(); o.material.dispose(); }
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function buildWorld(id, data) {
    const meta = data.scene, group = new THREE.Group(), bounds = new THREE.Box3(), v = new THREE.Vector3();
    let points = null, lift = null, plan = null, unit;
    if (data.positions) {
      if (mode === 'lift') lift = liftOf(meta.paths[0].refs[0], data.positions);
      // point sizes are in device pixels: cap them per CSS pixel. A long path's scene keeps more of its colour
      points = cloudPoints(data, {size: 3 * renderer.getPixelRatio(), fade: mode === 'points' ? .2 : .4, lift});
      // a long path's background reaches far: frame the scene around the path
      if (meta.focus) bounds.set(new THREE.Vector3(...meta.focus.min), new THREE.Vector3(...meta.focus.max));
      else bounds.setFromBufferAttribute(points.geometry.attributes.position);
      const size = bounds.getSize(v);
      // one unit ≈ a room of 9 m; frustums, lines and point sizes scale with it so halls and landmarks read the same
      // (a one-photo world goes by its median depth: its far points stretch far)
      unit = lift ? THREE.MathUtils.clamp(lift.depth / 3, .3, 10) : THREE.MathUtils.clamp(Math.max(size.x, size.y) / 9, 1, 10);
      // around a long path the scene stays clear and only the background beyond fades into the paper
      if (meta.focus) points.material.uniforms.uFog.value.set(1.4 * size.length(), 4 * size.length());
      else points.material.uniforms.uFog.value.set(4 * unit, 22 * unit);
      group.add(points);
    } else {
      // no points: the cameras set the scale, and the photos on them the frame (only this section's paths: a reconstruction can serve two)
      const paths = meta.paths.filter((_, k) => cases.some(c => c.cloud === id && c.path === k));
      for (const p of paths) for (const m of [...p.poses, ...p.refs.map(r => r.c2w)]) bounds.expandByPoint(v.set(m[0][3], m[1][3], m[2][3]));
      const size = bounds.getSize(v);
      unit = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) / 6, .3, 10);
      for (const p of paths) for (const r of p.refs) for (const q of corners(r.K, meta.image, REF * unit)) bounds.expandByPoint(q.applyMatrix4(poseMatrix(r.c2w)));
    }
    if (mode === 'cameras' && meta.plan) {
      // for a sense of space, the room's floor plan lies under the cameras as a soft shadow
      const {min, max, z} = meta.plan, tex = loader.load(`${id}/plan.png`);
      plan = new THREE.Mesh(new THREE.PlaneGeometry(max[0] - min[0], max[1] - min[1]),
        new THREE.MeshBasicMaterial({color: INK, alphaMap: tex, transparent: true, opacity: 0, depthWrite: false}));
      plan.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, z);
      group.add(plan);
    }
    scene.add(group);
    const w = {id, meta, group, points, lift, plan, bounds, unit, born: performance.now(), out: null, sel: null, old: []}, h = home(w);
    // room to zoom out well past the opening view (a long path's opening view is already far out)
    controls.maxDistance = Math.max(24 * unit, 2.5 * h.pos.distanceTo(h.target));
    return w;
  }

  // the one input photo of a 1.2 world: its camera, its forward axis, the depth its points sit at, and the image plane they start on
  function liftOf(ref, pos) {
    const M = poseMatrix(ref.c2w), eye = new THREE.Vector3().setFromMatrixPosition(M), fwd = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
    const ds = [];
    for (let i = 0; i < pos.length; i += 90) ds.push((pos[i] - eye.x) * fwd.x + (pos[i + 1] - eye.y) * fwd.y + (pos[i + 2] - eye.z) * fwd.z);
    ds.sort((a, b) => a - b);
    const depth = ds[ds.length >> 1];
    return {eye, fwd, depth, plane: depth * .35};
  }

  // `delay` holds the path back while a 1.2 world lifts in
  function setPath(c, delay = 0) {
    const w = world, u = w.unit, p = w.meta.paths[c.path], pts = p.poses.map(m => new THREE.Vector3(m[0][3], m[1][3], m[2][3]));
    const refDepth = w.lift ? w.lift.plane : REF * u;
    if (w.sel) {
      const old = w.sel;
      old.out = performance.now();
      old.head.visible = false;
      w.old.push(old);
      setTimeout(() => { w.group.remove(old.group); dispose(old.group); w.old = w.old.filter(o => o !== old); }, 500);
    }
    // the whole path faint, the stretch already travelled solid; seen from close behind its start, a 1.2 path needs a thinner line
    const thin = w.lift ? .4 : 1, group = new THREE.Group(), line = pathTube(pts, .012 * u * thin, OUTPUT, .22), trail = pathTube(pts, .012 * u * thin, OUTPUT, .85);
    const start = new THREE.Mesh(new THREE.SphereGeometry(.026 * u * thin, 16, 12), new THREE.MeshBasicMaterial({color: OUTPUT, transparent: true}));
    start.position.copy(pts[0]);
    // the camera being rendered: solid edges and a faint glass, no picture (the picture is the output card)
    const head = frustumSolid(p.K, w.meta.image, HEAD * u, OUTPUT, .009 * u * thin);
    head.userData.plane = imagePlane(p.K, w.meta.image, HEAD * u, null, .1);
    head.userData.plane.material.color = OUTPUT;
    head.add(head.userData.plane);
    head.visible = false;
    line.userData.upTo(0);
    trail.userData.upTo(0);
    const refs = p.refs.map(r => {
      const f = frustum(r.K, w.meta.image, refDepth, INPUT, 0), tex = loader.load(r.img);
      tex.colorSpace = THREE.SRGBColorSpace;
      f.userData.plane = imagePlane(r.K, w.meta.image, refDepth, tex, 0);
      f.add(f.userData.plane);
      Object.assign(f.userData, {base: poseMatrix(r.c2w), s: 1});
      f.matrix.copy(f.userData.base);
      f.matrixWorldNeedsUpdate = true;
      group.add(f);
      return f;
    });
    group.add(line, trail, start, head);
    // 1.1, for a sense of space: each camera's drop to the floor, and the path's shadow on it
    if (w.plan) {
      const z = w.meta.plan.z, down = q => new THREE.Vector3(q.x, q.y, z);
      for (const r of p.refs) { const c = new THREE.Vector3(r.c2w[0][3], r.c2w[1][3], r.c2w[2][3]); group.add(dashedLine([c, down(c)], INPUT, .22, .03 * u)); }
      group.add(dashedLine(pts.map(down), INK, .3, .05 * u));
    }
    w.group.add(group);
    peek(-1);
    w.sel = {group, line, trail, start, head, p, pts, refs, win: -1, born: performance.now() + delay, corners: corners(p.K, w.meta.image, HEAD * u)};
  }

  // the context photos of the window in use, as thumbnails
  function showWindow(s, wi) {
    s.win = wi;
    thumbs.replaceChildren(...s.p.windows[wi].refs.map(i => {
      const b = document.createElement('button');
      b.innerHTML = `<img src="${s.p.refs[i].img}" alt="">`;
      b.setAttribute('aria-label', `Context photo ${i + 1}`);
      b.addEventListener('mouseenter', () => {
        highlight(i);
        const r = b.getBoundingClientRect(), o = stage.getBoundingClientRect();
        peek(i, r.right - o.left, r.top - o.top + r.height / 2);
      });
      b.addEventListener('mouseleave', () => { highlight(-1); peek(-1); });
      b.dataset.ref = i;
      return b;
    }));
    highlight(hover);
  }

  function home(w = world) {
    if (w.lift) return liftView(w, 1);
    const b = w.bounds, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    if (w.points) c.z = w.meta.floor + s.z * .32;
    // fit the scene into the free area left of the video card
    const free = stage.clientWidth * (.5 - shift) * 2, half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.min(1, free / stage.clientHeight));
    const d = Math.hypot(s.x, s.y) * .5 / Math.sin(half) * 1.02;
    return {target: c, pos: c.clone().add(new THREE.Vector3(.62, -.74, .62).normalize().multiplyScalar(d))};
  }
  // 1.2: from the input camera itself, where the photo fills the free area (k = 0), easing back and a little aside,
  // still close to the input view, so the lifted points read in depth (k = 1); the field of view is set in go()
  function liftView(w, k) {
    const {eye, fwd, depth, plane} = w.lift, side = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const pos = eye.clone().addScaledVector(fwd, -depth * (.03 + .3 * k)).addScaledVector(side, depth * .16 * k).addScaledVector(camera.up, depth * .08 * k);
    return {target: eye.clone().addScaledVector(fwd, plane + (depth * .6 - plane) * k), pos};
  }
  function flyHome(dur = 1600) {
    fly = {from: {pos: camera.position.clone(), target: controls.target.clone()}, to: home(), t0: performance.now(), dur};
    reset.classList.remove('on');
  }

  function highlight(i) {
    hover = i;
    [...thumbs.children].forEach(b => b.classList.toggle('on', +b.dataset.ref === i));
  }
  // the hovered context photo, at full size beside the pointer (x, y in stage pixels)
  function peek(i, x, y) {
    const s = world?.sel;
    if (i < 0 || !s) return peekBox.classList.remove('on');
    if (!peekImg.src.endsWith(s.p.refs[i].img)) peekImg.src = s.p.refs[i].img;
    const w = peekBox.offsetWidth, h = w * .75;
    peekBox.style.left = `${Math.min(stage.clientWidth - w - 12, x + 18)}px`;
    peekBox.style.top = `${Math.max(12, Math.min(stage.clientHeight - h - 12, y - h / 2))}px`;
    peekBox.classList.add('on');
  }

  function mark() {
    const c = cases[at];
    if (credit) {
      if (c.el.credit) credit.innerHTML = c.el.credit;
      credit.classList.toggle('on', !!c.el.credit);
    }
    for (const el of list.children) {
      el.classList.toggle('on', el === c.el);
      [...el.querySelectorAll('.ex-dots button')].forEach((b, k) => b.setAttribute('aria-current', String(el === c.el && k === c.k)));
      if (el !== c.el) el.bar.style.transform = '';
    }
    // keep the current case in view on the strip
    const l = c.el.offsetLeft, r = l + c.el.offsetWidth;
    if (l < list.scrollLeft || r > list.scrollLeft + list.clientWidth) list.scrollTo({left: l - (list.clientWidth - c.el.offsetWidth) / 2, behavior: 'smooth'});
  }

  // go to case k: load its video on the hidden deck, swap the scene if needed, draw the path, then cross-fade
  async function go(k) {
    const my = ++token, c = cases[(k + cases.length) % cases.length];
    at = cases.indexOf(c);
    mark();
    const data = await load(c.cloud);
    if (my !== token) return;
    const p = data.scene.paths[c.path], next = decks[1 - live];
    prepareVideo(next.v, p.video);
    let hold = 0;
    if (!world || world.id !== c.cloud) {
      stage.dataset.state = 'loading';
      if (world) { world.out = performance.now(); decks[live].v.pause(); await wait(480); }
      if (my !== token) return;
      if (world) { scene.remove(world.group); dispose(world.group); }
      world = buildWorld(c.cloud, data);
      if (world.lift) {
        // look along the input camera, with a field of view a little wider than its own, so that its photo, and every point
        // lifted from it, fits the free area left of the card; start there, then ease out while the photo lifts into points.
        // The output follows the lift animation, never a preload event.
        const ref = world.meta.paths[0].refs[0], [W, H] = world.meta.image, free = stage.clientWidth * (.5 - shift) * 2;
        const fit = Math.min(.8, free / (stage.clientHeight * W / H) * .9);
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(H / 2 / ref.K[1] / fit));
        camera.updateProjectionMatrix();
        stage.classList.add('lifting');
        const from = liftView(world, 0);
        camera.position.copy(from.pos);
        controls.target.copy(from.target);
        fly = {from, to: liftView(world, 1), t0: performance.now() + LIFT_HOLD, dur: 1700};
        reset.classList.remove('on');
        hold = LIFT;
      } else flyHome(first ? 0 : 1600);
      first = false;
      stage.dataset.state = 'ready';
    }
    setPath(c, hold);
    if (hold) await wait(hold);
    if (my !== token) return;
    stage.classList.remove('lifting');
    const prev = decks[live];
    live = 1 - live;
    seekVideo(next.v, 0);
    world.sel.head.visible = true;
    next.v.classList.add('on');
    prev.v.classList.remove('on');
    prepareVideo(proxy, p.proxy, 0, proxyBox.classList.contains('on') ? 'auto' : 'none');
    playback.reset();
    requestAnimationFrame(() => { if (my === token && inView) playback.play(); });
    // once the old deck has faded, preload the following case on it
    setTimeout(async () => {
      if (my !== token) return;
      prev.v.pause();
      const n = cases[(at + 1) % cases.length], nd = await load(n.cloud);
      if (my !== token) return;
      prev.v.preload = 'auto';
      prev.v.src = nd.scene.paths[n.path].video;
    }, 700);
  }
  for (const d of decks) d.v.addEventListener('ended', () => d === decks[live] && go(performance.now() - touched < 15000 ? at : at + 1));

  proxyBtn.addEventListener('click', () => {
    const on = proxyBtn.getAttribute('aria-pressed') !== 'true';
    proxyBtn.setAttribute('aria-pressed', String(on));
    proxyBox.classList.toggle('on', on);
    playback.reset();
    if (on) { proxy.preload = 'auto'; seekVideo(proxy, decks[live].v.currentTime); if (inView) playback.play(true); } else proxy.pause();
  });

  // hover a context camera in 3D to light up its photo
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener('pointermove', e => {
    const s = world?.sel;
    if (!s || s.win < 0 || e.buttons) return;
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(s.p.windows[s.win].refs.map(i => s.refs[i].userData.plane))[0];
    const i = hit ? s.refs.findIndex(f => f.userData.plane === hit.object) : -1;
    if (i !== hover) highlight(i);
    peek(i, e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('pointerleave', () => { if (hover >= 0) highlight(-1); peek(-1); });
  canvas.addEventListener('dblclick', () => world && flyHome(1200));
  reset.addEventListener('click', () => world && flyHome(1200));

  // the 3D view draws once the figure is near; its video starts (and later moves on) only once half the stage is in view
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, {rootMargin: '80px'}).observe(root);
  new IntersectionObserver(([e]) => {
    inView = e.intersectionRatio >= .5;
    if (inView && at < 0) go(0);
    const v = decks[live].v;
    if (inView) playback.play(); else { v.pause(); proxy.pause(); }
  }, {threshold: [0, .5]}).observe(stage);
  decks.forEach(d => {
    d.v.addEventListener('playing', () => d === decks[live] && inView && proxyBox.classList.contains('on') && playback.play());
    d.v.addEventListener('pause', () => d === decks[live] && proxy.pause());
  });

  // the scene sits in the free area left of the card: shift the projection centre there
  let cardBox = null;
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight, s = stage.getBoundingClientRect(), r = screen.getBoundingClientRect();
    cardBox = {x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height};
    shift = .5 - Math.max(w * .4, cardBox.x - 12) / 2 / w;
    stage.style.setProperty('--free', `${Math.max(w * .4, cardBox.x - 12) / 2}px`);   // the centre of the area left of the card
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * shift, 0, w, h);
    beam.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }).observe(stage);

  const pos = new THREE.Vector3(), nxt = new THREE.Vector3(), M = new THREE.Matrix4(), S = new THREE.Matrix4(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const hull = pts => {
    // monotone chain on 8 points
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length > 1 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (hi.length > 1 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  };
  function drawBeam(s, alpha) {
    const w = stage.clientWidth, h = stage.clientHeight, q = [];
    for (const c of s.corners) {
      v3.copy(c).applyMatrix4(s.head.matrixWorld);
      if (v4.copy(v3).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) { alpha = 0; break; }
      v3.project(camera);
      q.push([(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h, 1]);
    }
    beam.style.opacity = alpha.toFixed(3);
    if (!alpha || !cardBox) return;
    const b = cardBox, card = [[b.x, b.y, 0], [b.x + b.w, b.y, 0], [b.x + b.w, b.y + b.h, 0], [b.x, b.y + b.h, 0]];
    const H = hull(q.concat(card)), f = n => n.toFixed(1);
    beamFill.setAttribute('d', 'M' + H.map(p => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z');
    // the two hull edges that run from the camera's frame to the card
    beamEdge.setAttribute('d', H.map((p, i) => [p, H[(i + 1) % H.length]]).filter(([a, c]) => a[2] !== c[2])
      .map(([a, c]) => `M${f(a[0])} ${f(a[1])}L${f(c[0])} ${f(c[1])}`).join(''));
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    grad.setAttribute('x1', f(cx)); grad.setAttribute('y1', f(cy));
    grad.setAttribute('x2', f(b.x)); grad.setAttribute('y2', f(b.y + b.h / 2));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || !world) return;
    const w = world, s = w.sel, d = decks[live];
    // scene in and out: points dissolve, cameras fade
    const k = w.out ? 1 - ease((now - w.out) / 450) : ease((now - w.born) / 1400);
    const lift = w.lift ? ease((now - w.born - LIFT_HOLD) / LIFT_RISE) : 1;
    // a 1.2 input camera shrinks to a small frame once its points have lifted
    const shrink = w.lift ? ease((now - w.born - LIFT) / 700) : 0;
    if (w.points) {
      w.points.material.uniforms.uReveal.value = k;
      w.points.material.uniforms.uLift.value = lift;
    }
    if (w.plan) w.plan.material.opacity = .16 * k;
    let beamAlpha = 0;
    if (s) {
      const n = s.p.poses.length, f = Math.min(n - 1, d.time() * w.meta.fps), i = Math.floor(f), a = f - i;
      M.copy(poseMatrix(s.p.poses[i]));
      pos.setFromMatrixPosition(M).lerp(nxt.setFromMatrixPosition(poseMatrix(s.p.poses[Math.min(n - 1, i + 1)])), a);
      M.setPosition(pos);
      s.head.matrix.copy(M);
      s.head.matrixWorldNeedsUpdate = true;
      const grow = ease((now - s.born) / 900);
      s.line.userData.upTo(grow);
      s.line.material.opacity = .22 * k;
      s.trail.userData.upTo(Math.min(grow, s.trail.userData.arcAt(f)));
      s.trail.material.opacity = .85 * k;
      s.start.material.opacity = k;
      beamAlpha = s.head.visible ? k * grow : 0;
      // the window in use is the last one that has started
      const wi = s.p.windows.reduce((b, win, j) => win.start <= f ? j : b, 0);
      if (wi !== s.win) showWindow(s, wi);
      const used = s.p.windows[wi].refs;
      s.refs.forEach((fr, j) => {
        const [l, pl] = !used.includes(j) ? OFF : hover < 0 || hover === j ? ON : DIM, m = fr.userData;
        // a 1.2 photo shows from the start, gives way to its points as they lift, and returns small on its camera
        const g = w.lift ? 1 : grow, fade = w.lift ? Math.max(1 - lift, shrink) : 1;
        m.lines.material.opacity += (l * k * g - m.lines.material.opacity) * .12;
        m.plane.material.opacity += (pl * k * g * fade - m.plane.material.opacity) * .12;
        if (mode !== 'points') {
          // 1.1: the photo under the pointer comes forward a little
          m.s = w.lift ? 1 - .75 * shrink : m.s + ((hover === j ? 1.12 : 1) - m.s) * .15;
          fr.matrix.copy(m.base).multiply(S.makeScale(m.s, m.s, m.s));
          fr.matrixWorldNeedsUpdate = true;
          m.plane.renderOrder = hover === j ? 1 : 0;
        }
      });
    }
    // the previous path fades while the new one draws in
    for (const o of w.old) {
      const e = 1 - ease((now - o.out) / 400);
      o.line.material.opacity = .22 * e * k;
      o.trail.material.opacity = .85 * e * k;
      o.start.material.opacity = e * k;
      o.refs.forEach(fr => { fr.userData.lines.material.opacity *= .85; fr.userData.plane.material.opacity *= .85; });
    }
    if (fly) {
      const e = fly.dur ? ease((now - fly.t0) / fly.dur) : 1;
      camera.position.lerpVectors(fly.from.pos, fly.to.pos, e);
      controls.target.lerpVectors(fly.from.target, fly.to.target, e);
      if (e >= 1) fly = null;
      camera.lookAt(controls.target);
    } else controls.update();
    if (proxyBox.classList.contains('on') && !d.v.seeking && proxy.readyState >= 2 && !proxy.seeking && Math.abs(proxy.currentTime - d.v.currentTime) > .15) proxy.currentTime = d.v.currentTime;
    if (d.v.duration) cases[at].el.bar.style.transform = `scaleX(${(d.v.currentTime / d.v.duration).toFixed(4)})`;
    if (w.points) {
      cutWalls(w.points, w.meta.walls, camera.position);
      w.points.material.uniforms.uScale.value = (w.meta.focus ? .02 : .014) * w.unit * canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    renderer.render(scene, camera);
    if (s) { s.head.updateMatrixWorld(); drawBeam(s, beamAlpha); } else beam.style.opacity = 0;
  }
  requestAnimationFrame(frame);
  load(cases[0].cloud);
}
