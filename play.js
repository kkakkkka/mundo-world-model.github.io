// Chapter 03: the physics playground (Fig. 4) and one program from start to finish (Fig. 5).
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {projectionFromK, PALETTE} from './world.js';
import {cooperativeZoom} from './space.js';
import {prepareVideo, seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ease = v => { v = Math.min(1, Math.max(0, v)); return v * v * v * (10 + v * (-15 + 6 * v)); };
const lazyInit = (el, fn) => {
  if (!el) return;
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fn().catch(err => console.error(err)); } }, {rootMargin: '500px'});
  io.observe(el);
};

/* ───────────────────────── 3.1 playground ───────────────────────── */
const NAMES = {bin_blue: 'Blue bin', monitor: 'Monitor', chair: 'Chair', drawer_1: 'Top drawer', drawer_2: 'Second drawer', drawer_3: 'Third drawer',
  drawer_4: 'Bottom drawer', desk: 'Desk'};
const HINTS = {bin_blue: 'drag across the floor', monitor: 'drag forward or back', chair: 'drag it back from the desk', drawers: 'pull out', desk: 'press down to pound it'};
const NICE = {Floor0: 'floor', Table0_3: 'far desk', Table0_7: 'desk leg', Table0_1: 'side desk', desk_board: 'desk', desk: 'desk', cabinet_left: 'pedestal',
  Cabinet1: 'wooden pedestal', Storage1: 'cabinet', bin_blue: 'blue bin', bin_maroon: 'maroon bin', pen_1: 'marker', pen_2: 'marker', pen_3: 'marker', pen_4: 'marker',
  dock: 'docking station', tin: 'tin', chair_seat: 'chair', Wall2: 'wall'};
const nice = n => NICE[n] ?? n.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\d+$/, '').toLowerCase();
const PUSH = {bin_blue: {z: .14, strong: .3, len: [.22, .42]}, monitor: {z: 1.12, strong: .28, len: [.2, .38]}, chair: {z: .2, strong: .3, len: [.2, .4]}};

lazyInit($('#playground'), async () => {
  const root = $('#playground'), stage = $('.play-stage', root), canvas = $('canvas', stage), video = $('.play-video', stage);
  const playback = videoPlayback(stage, () => [video]);
  const codeEl = $('[data-play-code]', root), outcome = $('[data-play-outcome]', root), labelsEl = $('.play-labels', stage);
  const hud = $('.play-hud', stage), camTabs = $$('[data-cam]', root), ctxGrid = $('[data-play-ctx]', root);
  const data = await fetch('play/scene.json').then(r => r.json());
  const programs = Object.fromEntries(data.programs.map(p => [p.id, p]));
  const traj = {};
  const loadTraj = id => traj[id] ??= fetch(`play/traj/${id}.json`).then(r => r.json());

  // renderer and the exact render camera (K) on a 4:3 canvas
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(new THREE.Color(PALETTE.unknown), 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 4 / 3, .03, 60);
  camera.up.set(0, 0, 1);
  const [[fx, , cx], [, fy, cy]] = data.K;
  const setProjection = () => {
    camera.projectionMatrix.copy(projectionFromK(fx, fy, cx, cy, 640, 480, .03, 60));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = .9;
  controls.maxDistance = 2.6;
  controls.rotateSpeed = .55;
  controls.zoomSpeed = .6;
  cooperativeZoom(stage, controls);

  // geometry: one group per MuJoCo body, flat proxy palette with darker true edges
  const bodies = {}, interactive = [], walls = [];
  const world = new THREE.Group();
  scene.add(world);
  const group = name => {
    if (!bodies[name]) { bodies[name] = new THREE.Group(); world.add(bodies[name]); }
    return bodies[name];
  };
  const shape = g => {
    const [a, b, c] = g.s;
    if (g.t === 'box') return new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
    if (g.t === 'sphere') return new THREE.SphereGeometry(a, 20, 12);
    if (g.t === 'shell') {   // [outer radius, inner radius, height, floor thickness], open at the top, turned about local z
      const [ro, ri, h, f] = g.s;
      return new THREE.LatheGeometry([[0, 0], [ro, 0], [ro, h], [ri, h], [ri, f], [0, f]].map(([x, y]) => new THREE.Vector2(x, y)), 48).rotateX(Math.PI / 2);
    }
    const geo = g.t === 'cylinder' ? new THREE.CylinderGeometry(a, a, 2 * b, 20) : new THREE.CapsuleGeometry(a, 2 * b, 4, 10);
    return geo.rotateX(Math.PI / 2);   // MuJoCo axis is local z
  };
  const owner = g => g.b === 'chair_seat' ? 'chair' : g.b;
  // a bin is simulated as a floor disc and 16 wall slabs (a hollow body); it is drawn as one turned shell, without the slab seams
  const shells = {};
  const geoms = data.geoms.filter(g => {
    if (!/^bin_/.test(g.b ?? '') || !/_(wall\d+|bottom)$/.test(g.n)) return true;
    (shells[g.b] ??= []).push(g);
    return false;
  });
  for (const [b, gs] of Object.entries(shells)) {
    const w = gs.find(g => /_wall0$/.test(g.n)), floor = gs.find(g => /_bottom$/.test(g.n)), r = Math.hypot(w.p[0], w.p[1]);
    geoms.push({n: b, b, t: 'shell', s: [r + w.s[0], r - w.s[0], 2 * w.s[2], 2 * floor.s[1]], p: [0, 0, 0], q: [1, 0, 0, 0], c: w.c});
  }
  for (const g of geoms) {
    if (g.b === 'apple') continue;
    const base = new THREE.Color(PALETTE[g.c] ?? PALETTE.object);
    const geo = shape(g);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), new THREE.LineBasicMaterial({color: base.clone().multiplyScalar(.78)}));
    mesh.add(edges);
    mesh.position.fromArray(g.p);
    mesh.quaternion.set(g.q[1], g.q[2], g.q[3], g.q[0]);
    mesh.userData = {base, edges, target: null};
    (g.b ? group(g.b) : world).add(mesh);
    const t = owner(g);
    if (t && (t in NAMES)) { mesh.userData.target = t; interactive.push(mesh); }
    if (g.c === 'wall' || g.c === 'window' || g.c === 'door' || /^Whiteboard/.test(g.n)) walls.push(mesh);
  }
  const pose = (name, v) => { const b = bodies[name]; if (!b) return; b.position.set(v[0], v[1], v[2]); b.quaternion.set(v[4], v[5], v[6], v[3]); };
  const resetPoses = () => { for (const [n, v] of Object.entries(data.bodies0)) pose(n, v); };
  resetPoses();
  // walls between the camera and the room are hidden (cut-away while orbiting)
  const room = new THREE.Vector3(2.5, 2.1, 1.2);
  for (const w of walls) {
    w.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(w.matrixWorld);
    w.userData.n = new THREE.Vector3().subVectors(room, p).setZ(0).normalize();
    w.userData.p = p;
  }
  const cutaway = () => {
    for (const w of walls) w.visible = new THREE.Vector3().subVectors(camera.position, w.userData.p).dot(w.userData.n) > -.05;
  };

  // views: OpenCV look-at (no roll) equals three.js lookAt with z up
  const views = data.views, viewKeys = Object.keys(views);
  let view = 'front', flying = null, state = 'explore';
  const eyeAt = (v, t = 0) => new THREE.Vector3(...views[v].eye).addScaledVector(new THREE.Vector3(...views[v].drift), ease(t));
  // a program may pan the look-at point part of the way toward where things land (MuJoCo-side FOLLOW)
  const camAt = (v, s, p) => {   // [eye, look-at]; mirrors interactions.camera (look-at pan and eye dolly)
    const eye = eyeAt(v, s / (data.frames / data.fps)), t = new THREE.Vector3(...views[v].target);
    if (!p?.follow) return [eye, t];
    const [to, k, a, b, dolly = 0] = p.follow, w = ease((s - a) / (b - a));
    t.lerp(new THREE.Vector3(...to), k * w);
    return [eye.lerp(t, dolly * w), t];
  };
  const place = (eye, target) => { camera.position.copy(eye); controls.target.copy(target); camera.lookAt(target); };
  const flyTo = (v, ms = 900) => new Promise(done => {
    const e0 = camera.position.clone(), t0 = controls.target.clone(), e1 = eyeAt(v), t1 = new THREE.Vector3(...views[v].target), start = performance.now();
    view = v;
    camTabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.cam === v)));
    showContext(v);
    flying = now => {
      const k = ease((now - start) / ms);
      place(e0.clone().lerp(e1, k), t0.clone().lerp(t1, k));
      if (k >= 1) { flying = null; done(); }
    };
  });
  const atView = () => camera.position.distanceTo(eyeAt(view)) < .03;
  const nearestView = () => viewKeys.reduce((a, b) => camera.position.distanceTo(eyeAt(a)) < camera.position.distanceTo(eyeAt(b)) ? a : b);
  const real = $('.play-real img', stage);
  const showContext = v => {
    real.src = `play/views/${v}.jpg`;
    ctxGrid.replaceChildren(...Array.from({length: 9}, (_, i) => Object.assign(document.createElement('img'),
      {src: `play/views/${v}-ctx-${String(i + 1).padStart(2, '0')}.jpg`, alt: `Context photograph ${i + 1} for the ${views[v].label} camera`, loading: 'lazy'})));
  };
  place(eyeAt(view), new THREE.Vector3(...views[view].target));
  showContext(view);
  camTabs.forEach(b => b.addEventListener('click', () => { if (state === 'run') stop(); flyTo(b.dataset.cam); }));

  // labels that guide the hand
  const anchors = {bin_blue: [1.495, 2.026, .45], monitor: [3.035, 2.30, 1.42], chair: [2.644, 3.32, 1.2], drawers: [2.058, 3.02, .5], desk: [3.45, 2.78, .93]};
  const labels = Object.fromEntries(Object.entries(anchors).map(([k, p]) => {
    const el = document.createElement('span');
    el.innerHTML = `<b>${k === 'drawers' ? 'Drawers' : NAMES[k]}</b>${HINTS[k]}`;
    labelsEl.append(el);
    return [k, {el, p: new THREE.Vector3(...p)}];
  }));
  const narrow = matchMedia('(max-width:600px)');
  const placeLabels = () => {
    const r = canvas.getBoundingClientRect();
    for (const {el, p} of Object.values(labels)) {
      const v = p.clone().project(camera);
      const ok = v.z < 1 && Math.abs(v.x) < .92 && Math.abs(v.y) < .9;
      el.style.opacity = ok && state === 'explore' ? '' : '0';
      let x = (v.x + 1) / 2 * r.width;
      if (narrow.matches) x = Math.min(x, r.width - el.offsetWidth - 6);   // on a phone's stage a label near the edge stays whole
      el.style.transform = `translate(${x.toFixed(1)}px,${((1 - v.y) / 2 * r.height).toFixed(1)}px)`;
    }
  };

  // hover highlight
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const NEW = new THREE.Color(PALETTE.new_object);
  let hovered = null;
  const setNdc = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); };
  const tint = (target, k) => {
    for (const m of interactive) {
      const on = m.userData.target === target || (target === 'drawers' && /^drawer_/.test(m.userData.target));
      m.material.color.copy(m.userData.base).lerp(NEW, on ? k : 0);
      m.userData.edges.material.color.copy(on && k ? NEW : m.userData.base.clone().multiplyScalar(.78));
    }
  };
  const pick = () => { const hit = ray.intersectObjects(interactive, false)[0]; return hit ? hit.object.userData.target : null; };

  // aiming: arrows snap to the simulated directions; length picks the strength
  const guides = new THREE.Group(), arrow = new THREE.Group();
  scene.add(guides, arrow);
  const flatArrow = (from, dir, len, color, width) => {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({color, depthTest: false, transparent: true, opacity: .95});
    const body = new THREE.Mesh(new THREE.PlaneGeometry(len - .06, width), mat);
    const head = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, -width * 2.2), new THREE.Vector2(.07, 0), new THREE.Vector2(0, width * 2.2)])), mat);
    body.position.x = (len - .06) / 2; head.position.x = len - .07;
    g.add(body, head);
    g.position.copy(from);
    g.rotation.z = Math.atan2(dir[1], dir[0]);
    g.renderOrder = 10;
    return g;
  };
  const center = t => new THREE.Vector3().setFromMatrixPosition(bodies[t].matrixWorld);
  let aim = null;   // {target, program, start}
  const select = id => {
    aim.program = id;
    setCode(`office.${programs[id].code}`, true);
  };
  const onAim = e => {
    setNdc(e);
    const t = aim.target;
    arrow.clear();
    if (t in PUSH) {
      const c = center(t), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PUSH[t].z), hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const v = new THREE.Vector2(hit.x - c.x, hit.y - c.y);
      if (v.length() < .05) { aim.program = null; setCode(null, true); return; }
      const dirs = Object.entries(data.dirs[t]).map(([k, d]) => [k, new THREE.Vector2(...d).normalize()]);
      const [, best] = dirs.reduce((a, b) => (a[1].dot(v) > b[1].dot(v) ? a : b));
      if (best.dot(v) < .3 * v.length()) { aim.program = null; setCode(null, true); return; }   // no simulated direction this way
      const level = v.length() > PUSH[t].strong ? 2 : 1;
      const p = data.programs.find(q => q.target === t && q.level === level && Math.abs(new THREE.Vector2(...q.dir).normalize().dot(best) - 1) < 1e-6);
      arrow.add(flatArrow(new THREE.Vector3(c.x, c.y, PUSH[t].z), [best.x, best.y], PUSH[t].len[level - 1], NEW, level === 2 ? .028 : .018));
      select(p.id);
    } else if (/^drawer_/.test(t)) {
      const dy = Math.max(0, (e.clientY - aim.start[1]) + Math.abs(e.clientX - aim.start[0]) * .3);
      const k = Math.min(1, dy / 90);
      bodies[t].position.y = data.bodies0[t][1] + .3 * k;
      if (k > .25) select(t); else { aim.program = null; setCode(null, true); }
    } else if (t === 'desk') {   // press down: a short press taps, a long one pounds; the board dips a little as a preview
      const press = Math.max(0, e.clientY - aim.start[1]);
      bodies.desk.position.z = data.bodies0.desk[2] - Math.min(.012, press / 8000);
      if (press >= 20) select(press >= 70 ? 'desk_pound_2' : 'desk_pound_1'); else { aim.program = null; setCode(null, true); }
    }
  };
  const showGuides = t => {
    guides.clear();
    if (!data.dirs[t]) return;
    const c = center(t);
    for (const d of Object.values(data.dirs[t])) {
      const n = new THREE.Vector2(...d).normalize();
      guides.add(flatArrow(new THREE.Vector3(c.x, c.y, PUSH[t].z), [n.x, n.y], PUSH[t].len[1] + .04, new THREE.Color('#ffffff'), .008));
    }
  };

  // code panel
  const BASE = [`<span class="c-k">office</span> = mundo.World(<span class="c-s">"office"</span>)  <span class="c-c"># 9 photos</span>`,
    () => `<span class="c-k">cam</span>    = office.camera(<span class="c-s">"${view}"</span>)`, '',
    null,
    `<span class="c-k">sim</span>    = office.simulate(<span class="c-n">5.2</span>)  <span class="c-c"># MuJoCo</span>`,
    `<span class="c-k">video</span>  = mundo.render(sim, cam, steps=<span class="c-n">50</span>)`];
  const highlight = s => s.replace(/("[^"]*"|'[^']*')/g, '<span class="c-s">$1</span>').replace(/([=(,]\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="c-n">$2</span>');
  let codeLine = null;
  function setCode(line, live = false) {
    codeLine = line;
    const act = line ? `<span class="c-line${live ? ' live' : ''}">${highlight(line.replace(/'/g, '"'))}</span>` : `<span class="c-line ghost"><span class="c-c"># drag an object to write this line</span></span>`;
    codeEl.innerHTML = BASE.map(b => b === null ? act : typeof b === 'function' ? b() : b).join('\n');
  }
  setCode(null);

  // running a program: its clip and the simulation replayed with it
  let running = null, runToken = 0;
  // when the last body comes to rest; most clips run on for a few still seconds after that
  const settleTime = tr => {
    let last = 0;
    for (const seq of Object.values(tr)) for (let f = 1; f < seq.length; f++)
      if (seq[f].some((v, i) => Math.abs(v - seq[f - 1][i]) > (i < 3 ? 2e-4 : 2e-3))) last = Math.max(last, f);
    return last / data.fps;
  };
  const stop = () => {
    runToken++;
    video.pause(); video.removeAttribute('src'); video.load();
    playback.reset();
    stage.dataset.state = state = 'explore';
    running = null;
    resetPoses();
    outcome.textContent = '';
  };
  async function run(id) {
    const my = ++runToken;
    const p = programs[id];
    state = 'run'; stage.dataset.state = 'busy';
    guides.clear(); arrow.clear(); tint(null, 0);
    hovered = null; hud.textContent = '';
    if (!atView()) await flyTo(nearestView(), 700);
    if (my !== runToken) return;
    const tr = await loadTraj(id);
    if (my !== runToken) return;
    resetPoses();
    const base = `play/clips/${id}__${view}/`;
    const src = await fetch(base + 'output.mp4', {method: 'HEAD'}).then(r => r.ok ? 'output.mp4' : 'proxy.mp4', () => 'proxy.mp4');
    if (my !== runToken) return;
    prepareVideo(video, base + src);
    playback.reset();
    stage.classList.toggle('proxy-only', src === 'proxy.mp4');
    setCode(`office.${p.code}`);
    outcome.innerHTML = `<b>${p.label}.</b> ${p.outcome}` + (p.ref ? `<img src="play/${p.ref}" alt="Generated reference for the open drawer">`
      + `<span>One generated reference image fixes this drawer's contents for all three cameras.</span>` : '') + (p.contacts.length ? `<span>${p.contacts.filter(c => c.t > data.t0)
      .slice(0, 3).map(c => `${c.t.toFixed(2)} s · ${c.pair.map(nice).join(' ↔ ')}${c.n > 1 ? ` · ${Math.round(c.n)} N` : ''}`).join('<br>')}</span>` : '');
    running = {id, tr, start: null, settle: settleTime(tr)};
    delete stage.dataset.user;
    stage.style.setProperty('--x', '100%');
    stage.dataset.state = 'run';
    if (visible) playback.play();
  }
  // once everything has come to rest the clip holds for a while (on its last frame if it ends first), then the room comes
  // back for another go
  const HOLD = 2.5;
  video.addEventListener('timeupdate', () => { if (state === 'run' && running && video.currentTime > running.settle + HOLD) stop(); });
  video.addEventListener('ended', () => {
    const was = running;
    if (state === 'run') setTimeout(() => running === was && stop(), 2000);
  });

  // proxy | video divider while a clip runs
  const handle = $('.play-divider', stage);
  let dragDiv = false;
  const setDiv = x => { const r = stage.getBoundingClientRect(); stage.style.setProperty('--x', (Math.min(1, Math.max(0, (x - r.left) / r.width)) * 100).toFixed(1) + '%'); };
  handle.addEventListener('pointerdown', e => { dragDiv = true; handle.setPointerCapture(e.pointerId); stage.dataset.user = '1'; });
  handle.addEventListener('pointermove', e => dragDiv && setDiv(e.clientX));
  handle.addEventListener('pointerup', () => dragDiv = false);

  // pointer handling on the 3D canvas
  canvas.addEventListener('pointermove', e => {
    if (aim) return onAim(e);
    if (state !== 'explore') return;
    setNdc(e);
    const t = pick();
    if (t !== hovered) {
      hovered = t;
      tint(hovered, .45);
      canvas.style.cursor = hovered ? 'grab' : '';
      hud.textContent = hovered ? `${NAMES[hovered]} · ${HINTS[/^drawer_/.test(hovered) ? 'drawers' : hovered]}` : '';
      if (hovered) showGuides(hovered); else guides.clear();
    }
  });
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'explore' && state !== 'done') return;
    if (state === 'done') stop();
    setNdc(e);
    const t = pick();
    if (!t) return;
    e.preventDefault();
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    aim = {target: t, program: null, start: [e.clientX, e.clientY]};
    stage.dataset.state = 'aim';
    tint(t, .7);
    showGuides(t);
  }, true);
  canvas.addEventListener('pointerup', () => {
    if (!aim) return;
    const id = aim.program;
    aim = null; controls.enabled = true; canvas.style.cursor = '';
    if (id) run(id);
    else { stage.dataset.state = 'explore'; resetPoses(); guides.clear(); arrow.clear(); tint(null, 0); setCode(null); }
  });
  controls.addEventListener('start', () => { if (state === 'explore') camTabs.forEach(b => b.setAttribute('aria-selected', 'false')); });
  $$('[data-play-try]', root).forEach(b => b.addEventListener('mouseenter', () => state === 'explore' && tint(b.dataset.playTry, .55)));
  $$('[data-play-try]', root).forEach(b => b.addEventListener('mouseleave', () => state === 'explore' && tint(null, 0)));

  // render loop: sim replay follows the video clock
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    setProjection();
  };
  new ResizeObserver(resize).observe(canvas);
  let visible = true;
  // the first time the stage is seen, the view turns a little left and right: a hint that it can be dragged
  let nudge = null;
  const startNudge = () => {
    if (nudge !== null || stage.dataset.user || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const e0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now() + 500;
    nudge = now => {
      const k = (now - start) / 2600;
      if (k < 0) return;
      if (k >= 1 || state !== 'explore' || stage.dataset.user) { nudge = false; return; }
      const a = .16 * Math.sin(k * Math.PI * 2) * Math.sin(k * Math.PI);
      const d = e0.clone().sub(t0), r = new THREE.Vector3(d.x * Math.cos(a) - d.y * Math.sin(a), d.x * Math.sin(a) + d.y * Math.cos(a), d.z);
      place(t0.clone().add(r), t0);
    };
  };
  canvas.addEventListener('pointerdown', () => { if (nudge) nudge = false; }, {capture: true});
  // a hint in the bottom-right corner that the room can be turned: for a few seconds when the stage is first seen, then
  // again after a quiet spell, until the room has been turned once
  const look = $('.play-look', stage);
  let looked = false, lookTimer = null;
  const showLook = () => {
    if (looked || !visible) { lookTimer = null; return; }
    if (state === 'explore') look.classList.add('on');
    lookTimer = setTimeout(() => { look.classList.remove('on'); lookTimer = setTimeout(showLook, 14000); }, 3600);
  };
  controls.addEventListener('start', () => { looked = true; clearTimeout(lookTimer); look.classList.remove('on'); });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && e.intersectionRatio >= .6 && lookTimer === null) showLook();
    if (visible && e.intersectionRatio >= .6 && nudge === null) startNudge();
    if (!visible) video.pause();
    else if (stage.dataset.state === 'run') playback.play();
  }, {threshold: [0, .6]}).observe(stage);
  renderer.setAnimationLoop(now => {
    if (!visible) return;
    if (flying) flying(now);
    else if (state === 'run' && running) {
      const t = Math.min(video.currentTime, data.frames / data.fps - 1e-3), f = Math.min(data.frames - 1, Math.floor(t * data.fps));
      for (const [n, seq] of Object.entries(running.tr)) pose(n, seq[f]);
      place(...camAt(view, t, programs[running.id]));
      if (!stage.dataset.user) stage.style.setProperty('--x', (100 * (1 - ease((t - .15) / 1.1))).toFixed(1) + '%');
    } else if (nudge) nudge(now);
    else if (!aim) controls.update();
    cutaway();
    placeLabels();
    renderer.render(scene, camera);
  });
  stage.dataset.state = 'explore';
});

/* ───────────────────────── 3.2 featured program ───────────────────────── */
lazyInit($('#program'), async () => {
  const root = $('#program'), out = $('video.feat-out', root), proxy = $('video.feat-proxy', root), overlay = $('canvas', root);
  const lines = $$('.feat-code [data-a]', root), hud = $('.feat-hud', root), svg = $('.feat-timeline svg', root);
  const d = await fetch('play/apple.json').then(r => r.json());
  const T = d.frames / d.fps;
  const has = await fetch('play/apple/output.mp4', {method: 'HEAD'}).then(r => r.ok, () => false);
  prepareVideo(out, has ? 'play/apple/output.mp4' : 'play/apple/proxy.mp4');
  prepareVideo(proxy, 'play/apple/proxy.mp4');
  const stage = $('.feat-stage', root), playback = videoPlayback(stage, () => [out, proxy]);
  let mode = 'physics', inView = false;
  $$('[data-feat]', root).forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.feat;
    $$('[data-feat]', root).forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('.feat', root).dataset.mode = mode;
    if (inView) playback.play();
  }));

  // timeline, drawn in CSS pixels so the labels keep their size: the monitor's tilt (0° upright, 90° on its side)
  // against video time, the slow-motion band, and the scripted events along the bottom
  const TOP = 30, BASE = 104, ROW = 13, deg = v => BASE - v / 90 * (BASE - TOP);
  let W = 0, head;
  const X = t => t / T * W;
  const el = (n, a) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', n);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    return e;
  };
  const text = (x, y, cls, s) => { const t = el('text', {x, y, class: cls}); t.textContent = s; svg.append(t); return t; };
  const evs = [[.6, 'drawer.open'], [1.9, 'float_to'], [d.slow.full, 'throw'], [d.contacts[0]?.t ?? 3.85, 'impact'],
    ...(d.freeze ? [[d.freeze.start, 'freeze'], [d.freeze.end, 'resume']] : []),
    [d.contacts.find(c => c.pair.includes('Table0_3'))?.t ?? 7.7, 'monitor lands']];
  const timeline = () => {
    if (!svg.clientWidth || svg.clientWidth === W) return;
    W = svg.clientWidth;
    svg.replaceChildren();
    svg.append(el('rect', {x: X(d.slow.full), y: 0, width: X(d.slow.end) - X(d.slow.full), height: BASE, class: 'tl-slow'}));
    if (d.freeze) {   // bullet time: the world stands still inside the slow-motion band
      svg.append(el('rect', {x: X(d.freeze.start), y: 0, width: X(d.freeze.end) - X(d.freeze.start), height: BASE, class: 'tl-freeze'}));
      text(X(d.freeze.start) + 6, 13, 'tl-label', 'bullet time ×0');
    }
    text(X(d.freeze ? d.freeze.end : d.slow.full) + 6, 13, 'tl-label', 'slow motion ×0.2');
    for (const v of [0, 90]) {
      svg.append(el('line', {x1: 0, x2: W, y1: deg(v), y2: deg(v), class: 'tl-grid'}));
      text(0, deg(v) - 5, 'tl-label', `${v}°`);
    }
    svg.append(el('polyline', {points: d.tilt.map((v, i) => `${X(i / d.fps).toFixed(1)},${deg(v).toFixed(1)}`).join(' '), class: 'tl-tilt'}));
    const name = text(W, deg(d.tilt.at(-1)) - 7, 'tl-name', 'monitor tilt');
    name.setAttribute('text-anchor', 'end');
    // labels go right to left, each on the first row where it overlaps no label and no longer tick placed before it
    const placed = [];
    let rows = 1;
    for (const [t, s] of [...evs].reverse()) {
      const x = X(t), t0 = text(x + 3, 0, 'tl-ev', s), end = x + 3 + t0.getComputedTextLength() + 8;
      let row = 0;
      while (placed.some(p => (p.row === row && p.x < end) || (p.row > row && p.x >= x && p.x < end))) row++;
      placed.push({x, row});
      rows = Math.max(rows, row + 1);
      t0.setAttribute('y', BASE + ROW * (row + 1) - 2);
      svg.append(el('line', {x1: x, x2: x, y1: BASE, y2: BASE + ROW * row + 4, class: 'tl-tick'}));
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${BASE + ROW * rows + 2}`);
    head = el('line', {x1: 0, x2: 0, y1: 0, y2: BASE, class: 'tl-head'});
    svg.append(head);
  };
  timeline();
  new ResizeObserver(timeline).observe(svg);
  svg.addEventListener('click', e => {
    const r = svg.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * T;
    [out, proxy].forEach(v => seekVideo(v, t));
  });

  // projection of simulated state into the generated frames (same c2w and K as the render)
  const ctx = overlay.getContext('2d');
  const project = (f, p) => {
    const m = d.c2w[f], [[fx, , cx], [, fy, cy]] = d.K;
    const q = [p[0] - m[0][3], p[1] - m[1][3], p[2] - m[2][3]];
    const x = m[0][0] * q[0] + m[1][0] * q[1] + m[2][0] * q[2], y = m[0][1] * q[0] + m[1][1] * q[1] + m[2][1] * q[2], z = m[0][2] * q[0] + m[1][2] * q[1] + m[2][2] * q[2];
    return z > .05 ? [fx * x / z + cx, fy * y / z + cy] : null;
  };
  const NEW = getComputedStyle(document.documentElement).getPropertyValue('--new').trim() || '#f39442';
  const draw = () => {
    const r = overlay.getBoundingClientRect(), s = r.width / 640, dpr = Math.min(devicePixelRatio, 2);
    if (overlay.width !== Math.round(r.width * dpr)) { overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    ctx.clearRect(0, 0, 640, 480);
    const t = out.currentTime, f = Math.min(d.frames - 1, Math.floor(t * d.fps));
    head?.setAttribute('x1', X(t)); head?.setAttribute('x2', X(t));
    lines.forEach(l => l.classList.toggle('on', t >= +l.dataset.a && t < +l.dataset.b));
    hud.innerHTML = `<span>t ${t.toFixed(2)} s</span><span>sim ${d.sim_time[f].toFixed(2)} s</span><span>×${d.rate[f].toFixed(2)}</span><span>tilt ${d.tilt[f].toFixed(0)}°</span>`;
    if (mode !== 'physics') return;
    ctx.lineCap = ctx.lineJoin = 'round';
    // monitor footprint and centre of mass: it tips once the CoM leaves the footprint
    const foot = d.foot[f].map(p => project(f, p)).filter(Boolean);
    const com = d.com[f], comP = project(f, com), ground = project(f, [com[0], com[1], d.foot[f][0][2]]);
    const inside = (() => { const c = d.foot[f]; let ok = true; for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; if ((b[0] - a[0]) * (com[1] - a[1]) - (b[1] - a[1]) * (com[0] - a[0]) < 0) ok = false; } return ok; })();
    const tipped = !inside || d.tilt[f] > 25;
    if (foot.length === d.foot[f].length) {
      ctx.beginPath(); foot.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = tipped ? 'rgba(243,148,66,.18)' : 'rgba(255,255,255,.22)'; ctx.fill();
      ctx.strokeStyle = tipped ? NEW : 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    if (comP && ground) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...comP); ctx.lineTo(...ground); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = tipped ? NEW : '#fff'; ctx.beginPath(); ctx.arc(...comP, 4, 0, 7); ctx.fill();
      label(comP[0] + 8, comP[1] - 6, tipped ? 'CoM outside base → tipping' : 'CoM over base');
    }
    // apple trail
    const trail = [];
    for (let i = Math.max(0, f - 14); i <= f; i++) { const p = project(i, d.bodies.apple[i]); if (p) trail.push(p); }
    trail.forEach(([x, y], i) => { ctx.fillStyle = `rgba(243,148,66,${((i + 1) / trail.length * .9).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, 1.5 + 2.5 * (i + 1) / trail.length, 0, 7); ctx.fill(); });
    if (d.apple_speed[f] > .3 && trail.length) label(trail.at(-1)[0] + 9, trail.at(-1)[1] + 14, `apple ${d.apple_speed[f].toFixed(1)} m/s`);
    // contact flashes
    for (const c of d.contacts) {
      const age = t - c.t;
      if (age < 0 || age > .8 || c.n < 50) continue;
      const p = project(f, c.point);
      if (!p) continue;
      ctx.strokeStyle = `rgba(243,148,66,${(1 - age / .8).toFixed(2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(...p, 6 + age * 30, 0, 7); ctx.stroke();
      label(p[0] + 10, p[1] - 10, `${c.pair.map(nice).join(' → ')} · ${c.n >= 1000 ? (c.n / 1000).toFixed(1) + ' kN' : Math.round(c.n) + ' N'}`);
    }
  };
  function label(x, y, text) {
    ctx.font = '500 10.5px "Geist Mono", monospace';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(18,18,17,.62)'; ctx.beginPath(); ctx.roundRect(x - 5, y - 11, w, 16, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(text, x, y + 1);
  }
  const loop = () => {
    if (!out.paused && !out.seeking && proxy.readyState >= 2 && !proxy.seeking && Math.abs(proxy.currentTime - out.currentTime) > .08) proxy.currentTime = out.currentTime;
    draw();
    requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => {
    inView = e.intersectionRatio >= .5;
    if (inView) playback.play();
    else { out.pause(); proxy.pause(); }
  }, {threshold: [0, .5]}).observe(stage);
  loop();
});
