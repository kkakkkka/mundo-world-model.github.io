// Robot interaction: one photograph, one task, five robots. The screen shows the simulation (the proxy) and Mundo's rendering
// of it on either side of a handle, and in a small window the robot's own head or wrist camera, split the same way; the curves
// beside it are read from the same simulation and follow the video's clock.
import {whenNear, clock} from './space.js';
import {prepareVideo, seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';

const root = document.getElementById('manip');
if (root) whenNear(root, init);

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.append(e);
  return e;
};
const num = (v, d) => (v.toFixed(d).startsWith('-') && +v.toFixed(d) ? '−' : '') + Math.abs(v).toFixed(d);   // a true minus sign, and no −0.00
// chart layout in pixels: name and value columns, the joint block, then the object's height and speed rows
const L = {name: 90, value: 58, top: 18, joints: 140, gap: 36, row: 30, rowGap: 8};

async function init() {
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const cases = await fetch('manip/cases.json').then(r => r.json());
  const runs = {}, run = id => runs[id] ??= fetch(`manip/${id}.json`).then(r => r.json());
  const stage = $('.mp-stage'), screen = $('.mp-screen'), handle = $('.mp-split'), plot = $('.mp-plot'), given = $$('.mp-given img');
  const peekBox = $('.ex-peek'), peekImg = $('.ex-peek img');
  const track = Object.fromEntries(['ahead', 'done', 'vel', 'at'].map(k => [k, $(`.mp-track .${k}`)]));
  // two decks (one shows while the other loads), each the scene camera's simulation and rendering and the robot's own camera's
  const pair = (view, k) => $$(`[data-view=${view}] .mp-deck`)[k];
  const decks = [0, 1].map(k => {
    const a = pair('scene', k), b = pair('ego', k);
    return {els: [a, b], sim: a.querySelector('.mp-sim'), gen: a.querySelector('.mp-gen'), egoSim: b.querySelector('.mp-sim'), egoGen: b.querySelector('.mp-gen')};
  });
  const vids = d => [d.gen, d.sim, d.egoGen, d.egoSim];
  decks.forEach(d => d.now = clock(d.gen));
  const egoCam = $('[data-view=ego] .mp-cam');
  let deck = decks[0], scene = cases.scenes[0], robot = cases.robots[0], data = null, chart = null, visible = false, inView = false, token = 0;

  // pickers: robots (their first reference picture) and tasks (the photograph)
  const chips = (kind, items, img) => {
    const box = $(`[data-pick=${kind}]`);
    box.innerHTML = items.map(it => `<button class="mp-chip" role="tab" aria-selected="false" data-id="${it.id}"><span><img src="${img(it)}" alt="" loading="lazy"></span>${it.name || it.title}</button>`).join('');
    return [...box.children];
  };
  const robotChips = chips('robot', cases.robots, r => `manip/refs/${r.id}_a.jpg`);
  const sceneChips = chips('scene', cases.scenes, s => `manip/${s.id}/thumb.jpg`);
  robotChips.forEach((b, k) => b.addEventListener('click', () => show(scene, cases.robots[k])));
  sceneChips.forEach((b, k) => b.addEventListener('click', () => show(cases.scenes[k], robot)));

  const playback = videoPlayback(screen, () => vids(deck));
  const play = () => playback.play();
  const pause = d => vids(d).forEach(v => v.pause());
  // Preserve the current time without waiting for hidden videos to preload or seek.
  async function show(s, r) {
    const my = ++token, t = deck.gen.src ? deck.now() : 0;
    robotChips.forEach(b => b.setAttribute('aria-selected', b.dataset.id === r.id));
    sceneChips.forEach(b => b.setAttribute('aria-selected', b.dataset.id === s.id));
    const d = await run(s.id);
    if (my !== token) return;
    const next = deck.gen.src ? decks.find(d => d !== deck) : deck;
    const src = ['_proxy', '', '_ego_proxy', '_ego'].map(k => `manip/${s.id}/${r.id}${k}.mp4`);
    [next.sim, next.gen, next.egoSim, next.egoGen].forEach((v, k) => prepareVideo(v, src[k], t));
    const old = deck;
    scene = s; robot = r; data = d; deck = next;
    given[0].src = `manip/${s.id}/photo.jpg`;
    given[1].src = `manip/refs/${r.id}_a.jpg`;
    given[2].src = `manip/refs/${r.id}_b.jpg`;
    egoCam.textContent = r.camera;
    decks.forEach(x => x.els.forEach(el => el.classList.toggle('on', x === deck)));
    playback.reset();
    requestAnimationFrame(() => { if (my === token && inView) play(); });
    if (old !== deck) setTimeout(() => { if (deck !== old) pause(old); }, 500);
    plot.classList.add('swap');
    setTimeout(() => { if (my !== token) return; build(); draw(t, true); plot.classList.remove('swap'); }, chart ? 220 : 0);
  }

  // ── the chart: one row per joint the robot moves (each on its own scale), then the object's height and speed,
  // with every robot's object in grey behind; solid up to the playhead, faint after it ──
  function build() {
    const W = plot.clientWidth, x0 = L.name, x1 = W - L.value, T = data.frames / data.fps;
    const X = t => x0 + t / T * (x1 - x0);
    const line = (n, y) => 'M' + n.map((v, i) => `${X(i / data.fps).toFixed(1)} ${y(v).toFixed(1)}`).join('L');
    const r = data.robots.find(x => x.id === robot.id);
    plot.replaceChildren();
    const past = el('rect', {x: 0, y: 0, height: 400}, el('clipPath', {id: 'mpPast'}, el('defs', {}, plot)));
    const ahead = el('g', {class: 'ahead'}), done = el('g', {'clip-path': 'url(#mpPast)'});
    const rows = [], bottom = L.top + L.joints + L.gap + 2 * L.row + L.rowGap;
    const curve = (n, y, cls) => [ahead, done].forEach(g => el('path', {class: cls, d: line(n, y)}, g));
    const label = (text, y, cls) => el('text', {x: 0, y, class: cls}, plot).textContent = text;

    // grasp and release: the phases change there
    for (const [name, t] of Object.entries(r.events)) {
      el('line', {class: 'guide', x1: X(t), x2: X(t), y1: L.top - 6, y2: bottom}, plot);
      el('text', {class: 'event', x: X(t), y: bottom + 13}, plot).textContent = name;
    }
    const phases = data.phases.map(p => {
      const e = el('text', {class: 'phase', x: X((p.a + p.b) / 2), y: 8}, plot);
      e.textContent = p.name;
      return {...p, e};
    });

    const rh = L.joints / r.joints.length, amp = Math.min(rh * .78, 17);
    r.joints.forEach((j, k) => {
      const base = L.top + k * rh + (rh + amp) / 2, y = v => base - v / 1000 * amp;
      label(j.name, base - amp / 2 + 3.5, 'name');
      curve(j.n, y, 'joint');
      const d = j.unit === 'm' ? 3 : 2;
      rows.push({n: j.n, y, cls: 'jdot', text: f => `${num(j.lo + j.n[f] / 1000 * (j.hi - j.lo), d)} ${j.unit}`, at: base - amp / 2 + 3.5});
    });

    const oy = L.top + L.joints + L.gap;
    const what = el('text', {x: 0, y: oy - 12, class: 'what'}, plot);
    what.textContent = data.object;
    const where = el('text', {x: x0, y: oy - 12}, plot);
    for (const [k, key, unit] of [[0, 'height', 'm'], [1, 'speed', 'm/s']]) {
      const top = oy + k * (L.row + L.rowGap), max = Math.max(...data.robots.flatMap(x => x.object[key]), .05);
      const y = v => top + L.row - Math.max(0, v) / max * L.row * .92;
      data.robots.forEach(x => { if (x !== r) el('path', {class: 'other', d: line(x.object[key], y)}, plot); });
      label(key, top + L.row / 2 + 3.5, 'name');
      curve(r.object[key], y, 'obj');
      rows.push({n: r.object[key], y, cls: 'odot', text: f => `${r.object[key][f].toFixed(2)} ${unit}`, at: top + L.row / 2 + 3.5});
    }
    plot.append(ahead, done);
    const head = el('line', {class: 'head', y1: L.top - 6, y2: bottom}, plot);
    for (const row of rows) {
      row.dot = el('circle', {r: 2.6, class: row.cls}, plot);
      row.val = el('text', {x: W, y: row.at, class: 'val'}, plot);
    }
    // the object's track in the image, drawn on the screen
    const uv = r.object.uv.map(([u, v]) => [u * 640, v * 480]), tip = r.object.tip.map(([u, v]) => [u * 640, v * 480]);
    const pts = P => P.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');
    track.ahead.setAttribute('d', 'M' + pts(uv));
    chart = {X, past, head, rows, phases, where, r, uv, tip, pts, last: -1};
  }

  function draw(t, force) {
    if (!chart) return;
    const c = chart, f = Math.min(data.frames - 1, Math.max(0, Math.round(t * data.fps)));
    if (f === c.last && !force) return;
    c.last = f;
    const x = c.X(f / data.fps);
    c.past.setAttribute('width', x);
    c.head.setAttribute('x1', x);
    c.head.setAttribute('x2', x);
    for (const row of c.rows) {
      row.dot.setAttribute('cx', x);
      row.dot.setAttribute('cy', row.y(row.n[f]));
      row.val.textContent = row.text(f);
    }
    for (const p of c.phases) p.e.classList.toggle('on', t >= p.a && t < p.b);
    const [px, py, pz] = c.r.object.pos[f];
    c.where.textContent = `x ${num(px, 2)} y ${num(py, 2)} z ${num(pz, 2)} m`;
    // the track so far, where the object is, and an arrow for its velocity
    const [u, v] = c.uv[f], [a, b] = c.tip[f], len = Math.hypot(a - u, b - v);
    track.done.setAttribute('d', 'M' + c.pts(c.uv.slice(0, f + 1)));
    track.at.setAttribute('cx', u);
    track.at.setAttribute('cy', v);
    if (len > 4) {
      const ux = (a - u) / len, uy = (b - v) / len, h = Math.min(7, len * .45);
      track.vel.setAttribute('d', `M${u + ux * 7} ${v + uy * 7}L${a} ${b}M${a - h * (ux - uy * .55)} ${b - h * (uy + ux * .55)}L${a} ${b}L${a - h * (ux + uy * .55)} ${b - h * (uy - ux * .55)}`);
    }
    track.vel.style.opacity = len > 4 ? 1 : 0;
  }

  // one clock: the rendering leads, the simulation follows it
  function tick() {
    if (!visible) return;
    requestAnimationFrame(tick);
    if (!data || !deck.gen.duration) return;
    const t = deck.now();
    if (!deck.gen.paused && !deck.gen.seeking) for (const v of [deck.sim, deck.egoGen, deck.egoSim]) if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - t) > .1) v.currentTime = t;
    draw(t);
  }

  // scrub on the chart
  plot.addEventListener('pointerdown', e => {
    if (!data) return;
    plot.setPointerCapture(e.pointerId);
    pause(deck);
    const seek = e => {
      const r = plot.getBoundingClientRect(), T = data.frames / data.fps;
      const t = Math.min(T - .02, Math.max(0, (e.clientX - r.left - L.name) / (r.width - L.name - L.value) * T));
      for (const v of vids(deck)) seekVideo(v, t);
      draw(t, true);
    };
    seek(e);
    plot.onpointermove = seek;
    plot.onpointerup = plot.onpointercancel = () => { plot.onpointermove = null; if (inView) play(); };
  });

  // the split: click to move it there, drag to follow; it opens from the simulation the first time it is seen
  let split = 1;
  const setSplit = v => {
    split = Math.min(1, Math.max(0, v));
    screen.style.setProperty('--s', split.toFixed(4));
    handle.setAttribute('aria-valuenow', Math.round(split * 100));
    screen.classList.toggle('gen-only', split < .12);
  };
  // the small window: the other camera. A click (or Enter) swaps it with the large one; it never moves the split
  const small = () => $(`[data-view=${screen.dataset.main === 'ego' ? 'scene' : 'ego'}]`);
  const mark = () => $$('[data-view]').forEach(v => {
    const on = v === small();
    v.tabIndex = on ? 0 : -1;
    v.setAttribute('role', on ? 'button' : 'presentation');
    on ? v.setAttribute('aria-label', `Show ${v.dataset.view === 'ego' ? "the robot's own camera" : 'the scene camera'} large`) : v.removeAttribute('aria-label');
  });
  const swap = () => { screen.dataset.main = screen.dataset.main === 'ego' ? 'scene' : 'ego'; mark(); };
  for (const v of $$('[data-view]')) {
    v.addEventListener('click', () => v === small() && swap());
    v.addEventListener('keydown', e => { if (v === small() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); swap(); } });
  }
  mark();
  screen.addEventListener('pointerdown', e => {
    if (small().contains(e.target)) return;
    screen.setPointerCapture(e.pointerId);
    const x = e.clientX, at = e => { const r = screen.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
    at(e);
    screen.onpointermove = e => { if (Math.abs(e.clientX - x) > 2) screen.classList.add('drag'); at(e); };
    screen.onpointerup = screen.onpointercancel = () => { screen.onpointermove = null; screen.classList.remove('drag'); };
  });
  handle.addEventListener('keydown', e => {
    const d = {ArrowLeft: -.05, ArrowRight: .05}[e.key];
    if (d) { e.preventDefault(); setSplit(split + d); }
  });
  const intro = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    intro.disconnect();
    setSplit(.5);
  }, {threshold: .6});
  intro.observe(screen);

  // hover a given picture to see it larger
  given.forEach(im => {
    im.addEventListener('mouseenter', () => {
      peekImg.src = im.src;
      const o = stage.getBoundingClientRect(), r = im.getBoundingClientRect(), w = peekBox.offsetWidth, h = w * .75;
      peekBox.style.left = `${Math.min(o.width - w - 12, r.right - o.left + 14)}px`;
      peekBox.style.top = `${Math.max(12, Math.min(o.height - h - 12, r.top - o.top + r.height / 2 - h / 2))}px`;
      peekBox.classList.add('on');
    });
    im.addEventListener('mouseleave', () => peekBox.classList.remove('on'));
  });

  new ResizeObserver(() => { if (data && chart) { build(); draw(deck.now(), true); } }).observe(plot);
  // the curves follow the clock once the figure is near; the videos play only once half the screen is in view
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) requestAnimationFrame(tick);
  }, {rootMargin: '120px 0px'}).observe(screen);
  new IntersectionObserver(([e]) => {
    inView = e.intersectionRatio >= .5;
    if (!inView) return decks.forEach(pause);
    if (deck.gen.src) play();
  }, {threshold: [0, .5]}).observe(screen);
  show(scene, robot);
}
