// Shared 3D pieces for the Exploration and Navigation viewers: point clouds, camera frustums, video planes, clocks.
import * as THREE from 'three';

export const PAPER = new THREE.Color('#f5f4f0');
export const INK = new THREE.Color('#161615');
// inputs in the ACE blue, outputs in the MMLab red (the logo colours)
export const INPUT = new THREE.Color('#2f37d8');
export const OUTPUT = new THREE.Color('#f42738');

export const ease = v => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); };

// Start work only when the element comes near the viewport and stays there a moment: a figure the page only scrolls
// past (a jump from the menu) is left unloaded, so it does not take the bandwidth from the one being read.
export function whenNear(el, fn) {
  let t;
  const io = new IntersectionObserver(([e]) => {
    clearTimeout(t);
    if (e.isIntersecting) t = setTimeout(() => { io.disconnect(); fn().catch(err => console.error(err)); }, 250);
  }, {rootMargin: '600px'});
  io.observe(el);
}

// A cloud as built: uint16 x y z (quantized between min and max) and uint8 r g b, interleaved. As published (`packed`):
// sorted along a Morton curve, each channel stored as the difference from the previous point and split into
// byte planes, so the server's gzip finds the repeats (lossless, a quarter to a third less to download). It is decoded here and the
// points are dealt back into a fixed pseudo-random order, so that see-through points layer as they did; arrays with one value per
// point (`extra`; `follow` for those loaded apart) go the same way. The published files are named *-mz.bin (`cloudFile`), so a page
// or JSON still cached from before can never read them as the old form.
export const cloudFile = (meta, f) => meta.packed ? f.replace(/\.bin$/, '-mz.bin') : f;
const dealt = {};
function dealOrder(n) {   // where the i-th stored point goes: a Fisher–Yates shuffle seeded by the count
  if (dealt[n]) return dealt[n];
  const at = new Uint32Array(n);
  for (let i = 0; i < n; i++) at[i] = i;
  let s = n >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (s + 0x6D2B79F5) >>> 0;
    let r = Math.imul(s ^ s >>> 15, 1 | s);
    r = (r + Math.imul(r ^ r >>> 7, 61 | r)) ^ r;
    const j = ((r ^ r >>> 14) >>> 0) % (i + 1);
    [at[i], at[j]] = [at[j], at[i]];
  }
  return dealt[n] = at;
}
export function follow({count: n, packed}, a) {
  if (!packed) return a;
  const at = dealOrder(n), out = new a.constructor(n);
  for (let i = 0; i < n; i++) out[at[i]] = a[i];
  return out;
}
export function decodeCloud(meta, qBuf, cBuf, ...extra) {
  const {count: n, min, max, packed} = meta, positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3);
  if (!packed) {
    const u16 = new Uint16Array(qBuf);
    for (let i = 0; i < n * 3; i++) positions[i] = min[i % 3] + u16[i] / 65535 * (max[i % 3] - min[i % 3]);
    colors.set(new Uint8Array(cBuf));
    return {positions, colors, extra};
  }
  const q = new Uint8Array(qBuf), c = new Uint8Array(cBuf), at = dealOrder(n);
  for (let k = 0; k < 3; k++) {
    const lo = 2 * k * n, hi = lo + n;
    for (let i = 0, v = 0, w = 0; i < n; i++) {
      v = (v + (q[lo + i] | q[hi + i] << 8)) & 65535;
      w = (w + c[k * n + i]) & 255;
      positions[3 * at[i] + k] = min[k] + v / 65535 * (max[k] - min[k]);
      colors[3 * at[i] + k] = w;
    }
  }
  return {positions, colors, extra: extra.map(a => follow(meta, a))};
}

// scene.json + quantized points (same format as the story cloud); without `points`, or for a scene that has none, just the scene.
export async function loadCloud(dir, points = true) {
  const get = (f, kind) => fetch(`${dir}/${f}`).then(r => r[kind]());
  const scene = await get('scene.json', 'json');
  if (!points || !scene.points) return {scene};
  const [q, c, w] = await Promise.all(['points.bin', 'colors.bin', 'walls.bin'].map(f => get(cloudFile(scene.points, f), 'arrayBuffer')));
  const {positions, colors, extra: [walls]} = decodeCloud(scene.points, q, c, new Uint8Array(w));
  return {scene, positions, colors, walls: Float32Array.from(walls)};
}

// Round, depth-faded points. `reveal` grows them in; walls facing the viewer are cut away (see cutWalls);
// with `seen`, points stay grey until a camera has seen them. `size` caps the point size in pixels; `fade` washes colours toward the paper.
// With `lift` ({eye, fwd, plane}), uLift moves the points from the input photo's image plane (at `plane` along `fwd`) out to their depth.
export function cloudPoints({positions, colors, walls}, {seen = null, size = 5, fade = 0, lift = null} = {}) {
  const n = positions.length / 3, g = new THREE.BufferGeometry(), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) rnd[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
  g.setAttribute('wall', new THREE.BufferAttribute(walls, 1));
  if (seen) g.setAttribute('seen', new THREE.BufferAttribute(seen, 1));
  const mat = new THREE.ShaderMaterial({
    defines: {...seen ? {SEEN: 1} : {}, ...lift ? {LIFT: 1} : {}},
    vertexColors: true,
    uniforms: {uScale: {value: 6}, uReveal: {value: 0}, uFrame: {value: 0}, uMax: {value: size}, uFade: {value: fade}, uFog: {value: new THREE.Vector2(4, 22)}, uCut: {value: new THREE.Vector4()},
      uPaper: {value: PAPER}, uAccent: {value: OUTPUT},
      uLift: {value: 0}, uEye: {value: lift?.eye ?? new THREE.Vector3()}, uFwd: {value: lift?.fwd ?? new THREE.Vector3()}, uPlane: {value: lift?.plane ?? 1}},
    vertexShader: `
      attribute float rnd, wall; uniform float uScale, uReveal, uFrame, uMax, uFade; uniform vec2 uFog; uniform vec4 uCut; uniform vec3 uPaper, uAccent; varying vec3 vColor;
      #ifdef SEEN
      attribute float seen;
      #endif
      #ifdef LIFT
      uniform float uLift, uPlane; uniform vec3 uEye, uFwd;
      #endif
      void main() {
        vec3 p = position;
        #ifdef LIFT
        // each point leaves the image plane along its own ray, a little staggered
        vec3 r = position - uEye;
        p = mix(uEye + r * (uPlane / max(dot(r, uFwd), 1e-3)), position, smoothstep(rnd * .35, rnd * .35 + .65, uLift));
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float grow = smoothstep(rnd, rnd + .08, uReveal * 1.08);
        float cut = dot(vec4(equal(vec4(wall), vec4(0., 1., 2., 3.))), uCut);
        grow *= 1. - smoothstep(rnd * .6, rnd * .6 + .4, cut);
        gl_PointSize = clamp(uScale / -mv.z, 1., uMax) * grow * step(.3, -mv.z);
        vec3 c = color;
        #ifdef SEEN
        float s = step(seen, uFrame), fresh = s * (1. - smoothstep(0., 30., uFrame - seen));
        vec3 grey = mix(uPaper, vec3(dot(c, vec3(.3, .59, .11))), .42);
        c = mix(mix(grey, c, s), uAccent, fresh * .3);
        #endif
        vColor = mix(c, uPaper, uFade + (1. - uFade) * smoothstep(uFog.x, uFog.y, -mv.z) * .55);
      }`,
    fragmentShader: `varying vec3 vColor; void main() { vec2 p = gl_PointCoord - .5; if (dot(p, p) > .25) discard; gl_FragColor = vec4(vColor, 1.); }`,
  });
  return new THREE.Points(g, mat);
}

// Wheel scrolls the page; ⌘/Ctrl + wheel (and a trackpad pinch, which arrives as Ctrl + wheel) zooms. A plain wheel over the view
// shows a hint instead. Listens in the capture phase on the canvas's container, so it runs before OrbitControls.
export function cooperativeZoom(el, controls) {
  const hint = document.createElement('p');
  hint.className = 'zoom-hint';
  hint.textContent = `${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} + scroll to zoom`;
  el.append(hint);
  let t;
  el.addEventListener('wheel', e => {
    controls.enableZoom = e.ctrlKey || e.metaKey;
    hint.classList.toggle('on', !controls.enableZoom);
    clearTimeout(t);
    t = setTimeout(() => hint.classList.remove('on'), 1200);
  }, {capture: true, passive: true});
}

// Fade out each wall whose outside faces the viewer, like a dollhouse; eased so orbiting feels continuous.
export function cutWalls(points, walls, eye) {
  const u = points.material.uniforms.uCut.value;
  walls.forEach(({c, n}, k) => {
    const dx = eye.x - c[0], dy = eye.y - c[1], facing = (n[0] * dx + n[1] * dy) / (Math.hypot(dx, dy) || 1);
    u.setComponent(k, u.getComponent(k) + ((facing > .12 ? 1 : 0) - u.getComponent(k)) * .08);
  });
}

// 3 × 4 OpenCV camera-to-world rows → Matrix4 (frustum geometry is built in OpenCV camera coordinates).
export const poseMatrix = p => new THREE.Matrix4().set(...p[0], ...p[1], ...p[2], 0, 0, 0, 1);
export const corners = ([fx, fy, cx, cy], [W, H], d) => [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) => new THREE.Vector3((u - cx) / fx * d, (v - cy) / fy * d, d));

export function frustum(K, size, d, color, opacity = 1) {
  const c = corners(K, size, d), o = new THREE.Vector3(), pts = [];
  for (let i = 0; i < 4; i++) pts.push(o, c[i], c[i], c[(i + 1) % 4]);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({color, transparent: true, opacity, depthWrite: false}));
  const group = new THREE.Group();
  group.add(lines);
  group.matrixAutoUpdate = false;
  group.userData.lines = lines;
  return group;
}

// A camera drawn with solid edges (WebGL lines are one pixel thin): a thin cylinder along each of the frustum's eight edges.
export function frustumSolid(K, size, d, color, radius) {
  const c = corners(K, size, d), o = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({color, transparent: true});
  for (const [a, b] of [[o, c[0]], [o, c[1]], [o, c[2]], [o, c[3]], [c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]]) {
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6), material);
    edge.position.copy(a).add(b).multiplyScalar(.5);
    edge.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    group.add(edge);
  }
  group.matrixAutoUpdate = false;
  group.userData.material = material;
  return group;
}

// The camera's picture, on its own image plane.
export function imagePlane(K, size, d, map, opacity = 1) {
  const c = corners(K, size, d), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap(v => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 3, 1, 1, 3, 2]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({map, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false}));
}

export function videoTexture(video) {
  const t = new THREE.VideoTexture(video);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A smooth tube along camera centres; draw range reveals the part already travelled.
export function pathTube(points, radius, color, opacity = 1) {
  // a camera holding still repeats its position: the curve skips repeats, whose zero-length step would flatten the whole tube
  const curve = new THREE.CatmullRomCurve3(points.filter((q, i) => !i || q.distanceToSquared(points[i - 1]) > 1e-12)), segs = points.length - 1;
  curve.arcLengthDivisions = 4 * segs;
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 6, false),
    new THREE.MeshBasicMaterial({color, transparent: opacity < 1, opacity, depthWrite: opacity === 1}));
  mesh.userData.upTo = f => mesh.geometry.setDrawRange(0, Math.round(Math.max(0, Math.min(1, f)) * segs) * 6 * 6);
  // the tube is spaced by arc length, not by point: arcAt(k) is the share of the length up to (fractional) point k, e.g. the current frame
  const run = [0];
  for (let i = 1; i < points.length; i++) run.push(run[i - 1] + points[i].distanceTo(points[i - 1]));
  mesh.userData.arcAt = k => {
    const i = Math.max(0, Math.min(segs, Math.floor(k))), j = Math.min(segs, i + 1);
    return (run[i] + (run[j] - run[i]) * Math.max(0, k - i)) / (run[segs] || 1);
  };
  return mesh;
}

export function dashedLine(points, color, opacity, dash = .06) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({color, transparent: true, opacity, dashSize: dash, gapSize: dash, depthWrite: false}));
  line.computeLineDistances();
  return line;
}

// Floor ring + drop line: where a camera or robot stands, and how high.
export function anchor(color) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(.07, .095, 40), new THREE.MeshBasicMaterial({color, transparent: true, opacity: .9, depthWrite: false}));
  const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]),
    new THREE.LineDashedMaterial({color, transparent: true, opacity: .55, dashSize: .04, gapSize: .04}));
  drop.computeLineDistances();
  const group = new THREE.Group();
  group.add(ring, drop);
  group.userData.set = (p, floor) => {
    ring.position.set(p.x, p.y, floor + .005);
    drop.position.set(p.x, p.y, floor);
    drop.scale.set(1, 1, Math.max(.001, p.z - floor));
  };
  return group;
}

// Video clock: frame-accurate time where requestVideoFrameCallback exists (and the last frame belongs to this source).
export function clock(video) {
  let media = 0;
  if ('requestVideoFrameCallback' in video) {
    const cb = (_, md) => { media = md.mediaTime; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
  return () => (video.paused || Math.abs(media - video.currentTime) > .25 ? video.currentTime : media);
}
