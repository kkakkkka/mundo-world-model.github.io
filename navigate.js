// Spatial Navigation: each robot walks the same office route. The map, the following camera's video and the head camera's video
// share one clock. The following camera fills the output and the head camera sits in the small window (a click swaps them).
// Each camera keeps one colour everywhere: red for the following camera, orange for the head camera, in the map, on the videos,
// and as the head camera's view drawn into the following camera's video from the two poses. Points turn from grey to colour
// once the head camera has seen them. The robots take turns.
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {prepareVideo, seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';
import {OUTPUT, PAPER, whenNear, loadCloud, follow, cloudFile, cloudPoints, cutWalls, poseMatrix, corners, frustumSolid,
  pathTube, dashedLine, anchor, clock, cooperativeZoom} from './space.js';

const root = document.getElementById('navfig');
if (root) whenNear(root, init);

const HEAD = new THREE.Color('#f39442');
const BODY = {humanoid: {h: 1.3, r: .17}, dog: {h: .55, l: .85, w: .45}};   // the dog is the box its proxy is
const CONE = .25;   // how far the head camera's view is drawn, in metres

async function init() {
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const stage = $('.nav-stage'), canvas = $('.nav-stage canvas'), screen = $('.nav-screen');
  const third = $('[data-view=third] video'), first = $('[data-view=first] video');
  const coneSvg = $('.nav-cone'), coneSide = $('.nav-cone .side'), coneEdge = $('.nav-cone .edge');
  const beam = $('.ex-beam'), beamFill = $('.ex-beam .fill'), beamEdge = $('.ex-beam .edge'), grad = $('.ex-beam linearGradient');
  const [cloud, route] = await Promise.all([loadCloud('explore/office'), fetch('navigate/route.json').then(r => r.json())]);
  const seenOf = id => fetch(`navigate/${cloudFile(cloud.scene.points, `${id}-seen.bin`)}`).then(r => r.arrayBuffer()).then(b => new Uint16Array(b));
  const [seenH, seenD] = await Promise.all([seenOf('humanoid'), seenOf('dog')]);
  // one value per office point, in the cloud's order
  const frameSeen = a => Float32Array.from(follow(cloud.scene.points, a), v => v === 65535 ? 1e6 : v);
  const seen = {humanoid: frameSeen(seenH), dog: frameSeen(seenD)};
  // each robot's own route (where it walked) and its two cameras
  const robotData = id => route.robots[id], size = route.size;

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(PAPER, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b5aa, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-2, -4, 8);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(34, 1, .03, 120);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {enableDamping: true, autoRotate: true, autoRotateSpeed: .3, minDistance: .8, maxDistance: 20});
  cooperativeZoom(stage, controls);
  controls.addEventListener('start', () => controls.autoRotate = false);

  const points = cloudPoints(cloud, {seen: seen.humanoid, size: 3.5, fade: .3});
  points.material.uniforms.uReveal.value = 1;
  scene.add(points);

  // the route is the input: dashed the whole way, solid where walked; drawn over the floor points so it always reads
  let walked = null, ahead = null;
  const goal = new THREE.Mesh(new THREE.RingGeometry(.1, .13, 40), new THREE.MeshBasicMaterial({color: OUTPUT, transparent: true, opacity: .8}));
  const start = new THREE.Mesh(new THREE.CircleGeometry(.05, 24), new THREE.MeshBasicMaterial({color: OUTPUT}));
  scene.add(goal, start);
  function drawRoute(r) {
    for (const o of [walked, ahead]) if (o) { scene.remove(o); o.geometry.dispose(); }
    const z = route.ground_z + .015, floor = r.root_xy.map(([x, y]) => new THREE.Vector3(x, y, z));
    walked = pathTube(floor, .014, OUTPUT);
    ahead = dashedLine(floor, OUTPUT, .55, .05);
    for (const o of [walked, ahead]) { o.material.depthTest = false; o.renderOrder = 2; }
    scene.add(ahead, walked);
    goal.position.copy(floor.at(-1));
    start.position.copy(floor[0]);
  }

  // robot: a simple body and a heading tick; its two cameras in their own colours, the head camera as deep as its view in the video
  const bodyMat = new THREE.MeshStandardMaterial({color: '#6d6a63', roughness: .6, transparent: true, opacity: .55, depthWrite: false});
  const bodies = {
    humanoid: new THREE.Mesh(new THREE.CapsuleGeometry(BODY.humanoid.r, BODY.humanoid.h - 2 * BODY.humanoid.r, 6, 18), bodyMat),
    dog: new THREE.Mesh(new THREE.BoxGeometry(BODY.dog.l, BODY.dog.w, BODY.dog.h), bodyMat),
  };
  bodies.humanoid.rotation.x = Math.PI / 2;
  const robot = new THREE.Group(), heading = new THREE.Mesh(new THREE.ConeGeometry(.05, .14, 3), new THREE.MeshBasicMaterial({color: HEAD}));
  heading.rotation.z = -Math.PI / 2;
  heading.position.set(.32, 0, .01);
  robot.add(bodies.humanoid, bodies.dog, heading);
  scene.add(robot);
  const thirdMark = anchor(OUTPUT);
  scene.add(thirdMark);
  let thirdCam = null, firstCam = null;
  function makeCameras(r) {
    for (const c of [thirdCam, firstCam]) if (c) scene.remove(c);
    thirdCam = frustumSolid(r.K3, size, .18, OUTPUT, .007);
    firstCam = frustumSolid(r.K1, size, CONE, HEAD, .007);
    thirdCam.userData.corners = corners(r.K3, size, .18);
    firstCam.userData.corners = corners(r.K1, size, CONE);
    scene.add(thirdCam, firstCam);
  }

  const bounds = new THREE.Box3().setFromBufferAttribute(points.geometry.attributes.position);
  const c = bounds.getCenter(new THREE.Vector3()), s = bounds.getSize(new THREE.Vector3()), radius = Math.max(s.x, s.y) * 1.45 + 1;
  const home = () => {
    controls.target.set(c.x, c.y, route.ground_z + .5);
    camera.position.set(c.x - .55 * radius, c.y - .95 * radius, route.ground_z + 1.15 * radius);
    controls.update();
  };
  home();

  let robotId = 'humanoid', r = robotData(robotId), visible = false, inView = false;
  const playback = videoPlayback(screen, () => [third, first]);
  function select(id) {
    robotId = id;
    r = robotData(id);
    $$('[data-robot]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.robot === id)));
    bodies.humanoid.visible = id === 'humanoid';
    bodies.dog.visible = id === 'dog';
    points.geometry.setAttribute('seen', new THREE.BufferAttribute(seen[id], 1));
    drawRoute(r);
    makeCameras(r);
    coneSvg.setAttribute('viewBox', `0 0 ${size[0]} ${size[1]}`);
    for (const [v, kind] of [[third, 'third'], [first, 'first']]) {
      v.poster = `navigate/${id}-${kind}.jpg`;
      prepareVideo(v, `navigate/${id}-${kind}.mp4`);
    }
    playback.reset();
    if (inView) playback.play();
  }
  $$('[data-robot]').forEach(b => b.addEventListener('click', () => b.dataset.robot !== robotId && select(b.dataset.robot)));
  select('humanoid');

  // the small window swaps with the large one
  const swap = () => { screen.dataset.main = root.dataset.main = screen.dataset.main === 'first' ? 'third' : 'first'; };
  root.dataset.main = 'third';
  for (const v of $$('.nav-view')) {
    v.addEventListener('click', () => v.dataset.view !== screen.dataset.main && swap());
    v.addEventListener('keydown', e => { if (v.dataset.view !== screen.dataset.main && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); swap(); } });
  }

  // the following camera's video is the clock; the head camera's follows it; at the end the other robot takes over
  const time = clock(third);
  third.addEventListener('ended', () => select(robotId === 'humanoid' ? 'dog' : 'humanoid'));
  third.addEventListener('pause', () => first.pause());
  third.addEventListener('seeked', () => seekVideo(first, third.currentTime));
  // the map draws and the videos load once the figure is near; they play (and the robots take turns) only once half of it is in view
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) for (const v of [third, first]) v.preload = 'auto';
  }, {rootMargin: '80px'}).observe(root);
  new IntersectionObserver(([e]) => {
    inView = e.intersectionRatio >= .5;
    if (inView) playback.play(); else playback.pause();
  }, {threshold: [0, .5]}).observe(screen);

  // the scene sits in the free area left of the card: shift the projection centre there (narrow screens put the card below the map)
  let cardBox = null;
  new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight, sb = stage.getBoundingClientRect(), sc = screen.getBoundingClientRect();
    cardBox = {x: sc.left - sb.left, y: sc.top - sb.top, w: sc.width, h: sc.height};
    const shift = cardBox.y < h ? .5 - Math.max(w * .4, cardBox.x - 12) / 2 / w : 0;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * shift, 0, w, h);
    beam.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }).observe(stage);

  const hull = pts => {
    // monotone chain
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length > 1 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (hi.length > 1 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  };
  const f1 = n => n.toFixed(1), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  // the beam: from the frame of the camera on the large screen to the screen
  function drawBeam(cam) {
    const w = canvas.clientWidth, h = canvas.clientHeight, q = [];
    let alpha = 1;
    for (const p of cam.userData.corners) {
      v3.copy(p).applyMatrix4(cam.matrixWorld);
      if (v4.copy(v3).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) { alpha = 0; break; }
      v3.project(camera);
      q.push([(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h, 1]);
    }
    beam.style.opacity = alpha;
    if (!alpha || !cardBox) return;
    const b = cardBox, H = hull(q.concat([[b.x, b.y, 0], [b.x + b.w, b.y, 0], [b.x + b.w, b.y + b.h, 0], [b.x, b.y + b.h, 0]]));
    beamFill.setAttribute('d', 'M' + H.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z');
    beamEdge.setAttribute('d', H.map((p, i) => [p, H[(i + 1) % H.length]]).filter(([a, c]) => a[2] !== c[2])
      .map(([a, c]) => `M${f1(a[0])} ${f1(a[1])}L${f1(c[0])} ${f1(c[1])}`).join(''));
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    grad.setAttribute('x1', f1(cx)); grad.setAttribute('y1', f1(cy));
    grad.setAttribute('x2', f1(b.x)); grad.setAttribute('y2', f1(b.y + b.h / 2));
  }
  // the head camera's view, as the following camera sees it: its apex and frame, projected through the following camera
  const coneCorners = () => [new THREE.Vector3(), ...corners(r.K1, size, CONE)];
  const M1 = new THREE.Matrix4(), M3 = new THREE.Matrix4();
  function drawCone(i) {
    M1.copy(poseMatrix(r.first[i]));
    M3.copy(poseMatrix(r.third[i])).invert();
    const [fx, fy, cx, cy] = r.K3, q = [];
    for (const p of coneCorners()) {
      v3.copy(p).applyMatrix4(M1).applyMatrix4(M3);
      if (v3.z < .05) { coneSide.setAttribute('d', ''); coneEdge.setAttribute('d', ''); return; }
      q.push([fx * v3.x / v3.z + cx, fy * v3.y / v3.z + cy]);
    }
    coneSide.setAttribute('d', 'M' + hull(q).map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z');
    const [o, ...k] = q;
    coneEdge.setAttribute('d', k.map(p => `M${f1(o[0])} ${f1(o[1])}L${f1(p[0])} ${f1(p[1])}`).join('') + 'M' + k.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z');
  }

  const pos = new THREE.Vector3(), M = new THREE.Matrix4();
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = time(), n = r.root_xy.length;
    const f = Math.min(n - 1, t * route.fps), i = Math.floor(f), j = Math.min(n - 1, i + 1), a = f - i;
    const [x0, y0] = r.root_xy[i], [x1, y1] = r.root_xy[j];
    robot.position.set(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, route.ground_z + BODY[robotId].h / 2);
    robot.rotation.z = r.yaw[i];
    heading.position.set(robotId === 'dog' ? BODY.dog.l / 2 + .12 : .32, 0, -BODY[robotId].h / 2 + .01);
    walked.userData.upTo(walked.userData.arcAt(f));
    firstCam.matrix.copy(poseMatrix(r.first[i]));
    thirdCam.matrix.copy(M.copy(poseMatrix(r.third[i])));
    firstCam.matrixWorldNeedsUpdate = thirdCam.matrixWorldNeedsUpdate = true;
    thirdMark.userData.set(pos.setFromMatrixPosition(M), route.ground_z);
    points.material.uniforms.uFrame.value = f;
    if (!third.seeking && first.readyState >= 2 && !first.seeking && Math.abs(first.currentTime - third.currentTime) > .1) first.currentTime = third.currentTime;
    drawCone(Math.min(n - 1, Math.round(f)));
    controls.update();
    cutWalls(points, cloud.scene.walls, camera.position);
    points.material.uniforms.uScale.value = .022 * canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    renderer.render(scene, camera);
    const main = screen.dataset.main === 'first' ? firstCam : thirdCam;
    main.updateMatrixWorld();
    drawBeam(main);
  }
  requestAnimationFrame(frame);
  canvas.addEventListener('dblclick', home);
}
