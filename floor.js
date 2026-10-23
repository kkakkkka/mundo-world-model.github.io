// Chapter 04 navigation: the whole hotel floor as its point cloud and the scene program's object boxes, with the route
// from the lobby to the hotel room planned on it and a robot walking it.
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {OUTPUT, whenNear, loadCloud, cloudPoints, pathTube, dashedLine, cooperativeZoom} from './space.js';
import {partGeometry} from './world.js';

const root = document.getElementById('floorfig');
if (root) whenNear(root, init);

const SPEED = 2.2, REST = [1.2, 2];   // shown speed (m/s), and the pause at the start and at the bed (s)

async function init() {
  const $ = s => root.querySelector(s);
  const stage = $('.floor-stage'), canvas = $('.floor-stage canvas'), labels = $('.floor-labels');
  const [cloud, program] = await Promise.all([loadCloud('floor'), fetch('floor/geometry.json').then(r => r.json())]);
  const {scene: meta} = cloud;

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b5aa, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-3, -6, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 2, .1, 300);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {enableDamping: true, maxDistance: 140, minDistance: 3});
  cooperativeZoom(stage, controls);
  // home: the long corridor across the frame, seen from its south side and fairly high, like a map
  const {min, max} = meta.points, target = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2 + 1.2, 0);   // a little north: the floor sits mid-frame
  const home = () => {
    const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const d = Math.max((max[0] - min[0]) / 2 / Math.tan(hf), (max[1] - min[1]) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.16;
    camera.position.copy(target).add(new THREE.Vector3(.06, -.55, .83).normalize().multiplyScalar(d));
    controls.target.copy(target);
    controls.update();
  };
  let moved = false;
  controls.addEventListener('start', () => moved = true);
  canvas.addEventListener('dblclick', () => { moved = false; home(); });

  // faint, so the program and the route read over them
  const points = cloudPoints(cloud, {size: 3 * renderer.getPixelRatio(), fade: .5});
  points.material.uniforms.uReveal.value = 1;
  points.material.uniforms.uFog.value.set(200, 400);
  scene.add(points);

  // the program's objects as boxes: a light tint of their colour and crisp edges in a deeper shade, so they read over
  // the cloud; floors, walls and ceilings left out (the cloud already shows them). Each is named by its category and
  // its index among the boxes of that category.
  const boxes = [], count = {};
  for (const p of program) {
    if (p.layer !== 'objects') continue;
    const g = partGeometry(p).toNonIndexed();
    g.computeVertexNormals();
    const color = new THREE.Color().setRGB(...p.color, THREE.SRGBColorSpace), edge = color.clone().offsetHSL(0, .25, -.28);
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({color, side: THREE.DoubleSide, transparent: true, opacity: .42, depthWrite: false}));
    // the edges sit in the transparent pass too, so a hovered box's outline can be drawn after every fill
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({color: edge, transparent: true})));
    mesh.renderOrder = 1;
    count[p.category] = (count[p.category] ?? 0) + 1;
    Object.assign(mesh.userData, {name: `${p.category} #${count[p.category]}`, edge});
    boxes.push(mesh);
    scene.add(mesh);
  }

  // the route: dashed the whole way, solid where walked; drawn over the floor so it always reads
  const z = meta.floor_z + .03, route = meta.route.map(([x, y]) => new THREE.Vector3(x, y, z));
  const walked = pathTube(route, .05, OUTPUT), ahead = dashedLine(route, OUTPUT, .6, .22);
  for (const o of [walked, ahead]) { o.material.depthTest = false; o.renderOrder = 2; }
  const start = new THREE.Mesh(new THREE.CircleGeometry(.16, 24), new THREE.MeshBasicMaterial({color: OUTPUT, depthTest: false}));
  const goal = new THREE.Mesh(new THREE.RingGeometry(.32, .4, 40), new THREE.MeshBasicMaterial({color: OUTPUT, transparent: true, opacity: .85, depthTest: false}));
  start.position.copy(route[0]);
  goal.position.copy(route.at(-1));
  for (const o of [start, goal]) o.renderOrder = 3;
  scene.add(ahead, walked, start, goal);
  // the robot: a simple body and a heading tick, as in Section 2.1, on a ring that keeps it visible across the whole floor
  const robot = new THREE.Group(), body = new THREE.Mesh(new THREE.CapsuleGeometry(.3, 1.3, 6, 18), new THREE.MeshStandardMaterial({color: '#3a3a37', roughness: .6}));
  body.rotation.x = Math.PI / 2;
  body.position.z = .95;
  const heading = new THREE.Mesh(new THREE.ConeGeometry(.16, .42, 3), new THREE.MeshBasicMaterial({color: OUTPUT, depthTest: false}));
  heading.rotation.z = -Math.PI / 2;
  heading.position.set(.78, 0, .02);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.62, 40), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: .85, depthTest: false}));
  const ring = new THREE.Mesh(new THREE.RingGeometry(.56, .66, 48), new THREE.MeshBasicMaterial({color: OUTPUT, depthTest: false}));
  disc.renderOrder = 3;
  ring.renderOrder = heading.renderOrder = 4;
  robot.add(disc, ring, body, heading);
  scene.add(robot);

  // room names, kept over their rooms as the view turns
  const rooms = meta.rooms.map(r => {
    const el = document.createElement('span');
    el.textContent = r.name;
    labels.append(el);
    return {el, at: new THREE.Vector3(r.at[0], r.at[1], z + 2.4)};
  });

  // hovering a box (or tapping it) names it next to the pointer and fills it in
  const tip = document.createElement('span');
  tip.className = 'floor-tip';
  stage.append(tip);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hover = null;
  const lit = new THREE.Color(OUTPUT);
  const mark = hit => {
    if (hit === hover) return;
    // the lit outline is drawn over everything, so the whole box shows even behind its neighbours
    const set = (m, on) => {
      const line = m.children[0];
      m.material.opacity = on ? .7 : .42;
      line.material.color.copy(on ? lit : m.userData.edge);
      line.material.depthTest = !on;
      line.renderOrder = on ? 5 : 0;
    };
    if (hover) set(hover, false);
    if (hit) set(hit, true);
    hover = hit;
  };
  const pick = e => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    ndc.set(x / r.width * 2 - 1, -y / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    mark(ray.intersectObjects(boxes, false)[0]?.object ?? null);
    tip.classList.toggle('on', !!hover);
    if (!hover) return;
    tip.textContent = hover.userData.name;
    tip.style.transform = `translate(${x > r.width - 180 ? x - 12 - tip.offsetWidth : x + 12}px, ${y + 14}px)`;
  };
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) pick(e); });
  canvas.addEventListener('click', e => { if (e.pointerType !== 'mouse') pick(e); });
  canvas.addEventListener('pointerleave', () => { mark(null); tip.classList.remove('on'); });

  // walking the route, then a pause at the bed and round again
  const run = [0];
  for (let i = 1; i < route.length; i++) run.push(run[i - 1] + route[i].distanceTo(route[i - 1]));
  const L = run.at(-1), walk = L / SPEED, loop = REST[0] + walk + REST[1];
  const at = d => {
    let i = 0;
    while (i < run.length - 2 && run[i + 1] < d) i++;
    return i + (d - run[i]) / Math.max(1e-6, run[i + 1] - run[i]);
  };
  const tmp = new THREE.Vector3();
  let visible = false, clockMs = 0, last = null;   // the walk's own clock, held while the figure is off screen
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);
  new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!moved) home();
  }).observe(canvas);
  stage.dataset.state = 'ready';
  renderer.setAnimationLoop(now => {
    const dt = last == null ? 0 : now - last;
    last = now;
    if (!visible) return;
    clockMs += dt;
    controls.update();
    const t = (clockMs / 1000) % loop, k = Math.min(1, Math.max(0, (t - REST[0]) / walk));
    // an even pace, speeding up over the first 6 % of the time and slowing over the last 6 %
    const e = k < .06 ? .03 * (k / .06) ** 2 : k > .94 ? 1 - .03 * ((1 - k) / .06) ** 2 : .03 + (k - .06) / .88 * .94;
    const f = at(e * L), i = Math.min(route.length - 2, Math.floor(f));
    robot.position.lerpVectors(route[i], route[i + 1], f - i);
    tmp.subVectors(route[Math.min(route.length - 1, i + 3)], route[Math.max(0, i - 3)]);
    robot.rotation.z = Math.atan2(tmp.y, tmp.x);
    walked.userData.upTo(walked.userData.arcAt(f));
    points.material.uniforms.uScale.value = .045 * canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    renderer.render(scene, camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const r of rooms) {
      tmp.copy(r.at).project(camera);
      r.el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmp.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`;
      r.el.style.opacity = tmp.z < 1 ? '' : 0;
    }
  });
}
