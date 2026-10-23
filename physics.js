// Physics from one photo: each scene's simulation drawn over Mundo's rendering of it. Trails and velocity arrows follow the
// centres of mass, rings mark the contacts with their peak force, a gauge shows gravity; the curves beside it share the clock.
import {whenNear, clock} from './space.js';
import {prepareVideo, seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';

const root = document.getElementById('phys');
if (root) whenNear(root, init);

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.append(e);
  return e;
};
const force = n => n >= 1000 ? `${(n / 1000).toFixed(1)} kN` : `${Math.round(n)} N`;
const RING = .8;   // seconds a contact ring stays
// chart layout in pixels: name and value columns, the rows, then the impacts row
const L = {name: 96, value: 62, top: 16, rows: 136, gap: 14, hits: 28};

async function init() {
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const cases = await fetch('physics/cases.json').then(r => r.json());
  const runs = {}, run = id => runs[id] ??= fetch(`physics/${id}.json`).then(r => r.json());
  const stage = $('.mp-stage'), screen = $('.ph-screen'), canvas = $('.ph-screen canvas'), ctx = canvas.getContext('2d');
  const plot = $('.ph-plot'), photo = $('.ph-given img'), src = $('.ph-src'), params = $('.ph-params'), hud = $('.ph-hud'), slowTag = $('.ph-slow');
  const gauge = {box: $('.ph-g'), arrow: $('.ph-g .now'), text: $('.ph-g span')};
  const peekBox = $('.ex-peek'), peekImg = $('.ex-peek img'), toggle = $('[data-ph-overlay]');
  // two decks, each a rendering on the screen and its simulation beside the photo: one shows while the other loads
  const outs = $$('.ph-out'), sims = $$('.ph-sim'), decks = [0, 1].map(k => ({out: outs[k], sim: sims[k]}));
  decks.forEach(d => d.now = clock(d.out));
  let deck = decks[0], cur = null, data = null, chart = null, visible = false, inView = false, token = 0, g = 9.81;
  let pass = 0, lastT = 0;   // a slowed clip alternates: pass 0 at real speed, pass 1 as rendered

  const box = $('[data-pick=case]');
  box.innerHTML = cases.map(c => `<button class="mp-chip" role="tab" aria-selected="false"><span><img src="physics/${c.id}/thumb.jpg" alt="" loading="lazy">` +
    `<em class="ph-tag mono">${c.source === 'real' ? 'Real photo' : 'AI-generated'}</em></span>${c.title}</button>`).join('');
  const chips = [...box.children];
  chips.forEach((b, k) => b.addEventListener('click', () => show(k)));
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', on);
    screen.classList.toggle('bare', !on);
  });

  const playback = videoPlayback(screen, () => [deck.out, deck.sim]);
  const play = () => playback.play();
  // Scene data can load first, but video preloading must not gate play().
  async function show(k) {
    const my = ++token, c = cases[k];
    chips.forEach((b, j) => b.setAttribute('aria-selected', j === k));
    const d = await run(c.id);
    if (my !== token) return;
    const next = deck.out.src ? decks.find(d => d !== deck) : deck;
    for (const [v, name] of [[next.sim, 'proxy'], [next.out, 'output']]) {
      const want = `physics/${c.id}/${name}.mp4`;
      v.poster = name === 'output' ? `physics/${c.id}/poster.jpg` : '';
      prepareVideo(v, want);
    }
    const old = deck;
    cur = c; data = d; deck = next; g = d.g[0];
    pass = 0; lastT = 0;
    for (const x of decks) x.out.playbackRate = x.sim.playbackRate = 1;
    slowTag.classList.remove('on');
    photo.src = `physics/${c.id}/photo.jpg`;
    src.textContent = c.source === 'real' ? 'Real photo' : 'AI-generated image';
    params.innerHTML = d.params.map(p => `<li>${p}</li>`).join('');
    decks.forEach(x => [x.out, x.sim].forEach(v => v.classList.toggle('on', x === deck)));
    playback.reset();
    requestAnimationFrame(() => { if (my === token && inView) play(); });
    if (old !== deck) setTimeout(() => { if (deck !== old) { old.out.pause(); old.sim.pause(); } }, 500);
    plot.classList.add('swap');
    setTimeout(() => { if (my !== token) return; build(); draw(0, true); plot.classList.remove('swap'); }, chart ? 220 : 0);
  }

  // ── the chart: one row per quantity (own scale; rows of one kind share it), impacts underneath, slow motion shaded ──
  function build() {
    const W = plot.clientWidth, x0 = L.name, x1 = W - L.value, T = data.frames / data.fps;
    const X = t => x0 + t / T * (x1 - x0);
    const line = (v, y) => {   // gaps (null) lift the pen
      let d = '', pen = false;
      v.forEach((a, i) => { if (a != null) d += `${pen ? 'L' : 'M'}${X(i / data.fps).toFixed(1)} ${y(a).toFixed(1)}`; pen = a != null; });
      return d;
    };
    plot.replaceChildren();
    const past = el('rect', {x: 0, y: 0, height: 400}, el('clipPath', {id: 'phPast'}, el('defs', {}, plot)));
    const ahead = el('g', {class: 'ahead'}), done = el('g', {'clip-path': 'url(#phPast)'});
    const hy = L.top + L.rows + L.gap, bottom = hy + L.hits;
    const text = (s, x, y, cls) => { const e = el('text', {x, y, class: cls}, plot); e.textContent = s; return e; };

    // slow motion: where simulated time runs slower than the video
    for (let i = 0; i < data.frames;) {
      if (data.rate[i] >= .9) { i++; continue; }
      let j = i;
      while (j < data.frames && data.rate[j] < .9) j++;
      el('rect', {class: 'slow', x: X(i / data.fps), y: L.top - 4, width: X(j / data.fps) - X(i / data.fps), height: bottom - L.top + 4}, plot);
      text(`slow motion ×${Math.min(...data.rate.slice(i, j)).toFixed(2)}`, X(i / data.fps) + 5, 8, 'phase');
      i = j;
    }
    const rows = [], n = data.rows.length, rh = L.rows / n, amp = Math.min(rh * .8, 34);
    const max = kind => Math.max(...data.rows.filter(r => r.unit === kind).flatMap(r => r.v.concat(r.earth || []).filter(v => v != null)), 1e-3);
    data.rows.forEach((r, k) => {
      const base = L.top + k * rh + (rh + amp) / 2, top = r.max ?? (r.unit === '°' ? Math.max(90, max('°')) : max(r.unit));
      const y = v => base - Math.max(0, v) / top * amp;
      text(r.name, 0, base - amp / 2 + 3.5, 'name');
      if (r.earth) {
        el('path', {class: 'other earth', d: line(r.earth, y)}, plot);
        const peak = r.earth.reduce((b, v, i) => v != null && v > (r.earth[b] ?? -1) ? i : b, 0);
        if (k === 0) text('on Earth', X(peak / data.fps), y(0) + 11, 'event');
      }
      [ahead, done].forEach(gr => el('path', {class: 'obj', d: line(r.v, y)}, gr));
      const d = r.unit === '°' ? 0 : r.unit === '' ? 0 : 2;
      rows.push({v: r.v, y, cls: 'odot', text: f => r.unit === '' ? `${r.v[f]} / ${r.max}` : `${r.v[f].toFixed(d)}${r.unit === '°' ? '°' : ' ' + r.unit}`, at: base - amp / 2 + 3.5});
    });
    // impacts: one stem per contact (and per bounce), its height the peak force on a log scale
    const hits = data.contacts.filter(c => c.n >= 30).map(c => ({t: c.t, n: c.n}));
    for (const b of Object.values(data.bounce || {})) for (const f of b.hits) if (!hits.some(h => Math.abs(h.t - f / data.fps) < .06)) hits.push({t: f / data.fps, n: null});
    const top = Math.log10(Math.max(...hits.map(h => h.n || 0), 100));
    text('impacts', 0, hy + L.hits - 6, 'name');
    el('line', {class: 'guide', x1: x0, x2: x1, y1: bottom, y2: bottom}, plot);
    const stems = hits.map(h => {
      const s = h.n ? Math.max(.2, Math.log10(h.n) / top) : .2, x = X(h.t);
      [ahead, done].forEach(gr => el('line', {class: 'hit', x1: x, x2: x, y1: bottom, y2: bottom - s * L.hits}, gr));
      return h;
    });
    plot.append(ahead, done);
    const head = el('line', {class: 'head', y1: L.top - 6, y2: bottom}, plot);
    for (const row of rows) {
      row.dot = el('circle', {r: 2.6, class: row.cls}, plot);
      row.val = el('text', {x: W, y: row.at, class: 'val'}, plot);
    }
    const last = el('text', {x: W, y: hy + L.hits - 6, class: 'val'}, plot);
    chart = {X, past, head, rows, stems, last, lastF: -1};
  }

  // ── the screen overlay, in the 640 × 480 pixels of the render, through the camera of each frame ──
  function project(f, p) {
    const m = data.c2w[f], [fx, fy, cx, cy] = data.K;
    const q = [p[0] - m[3], p[1] - m[7], p[2] - m[11]];
    const x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2], y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2], z = m[2] * q[0] + m[6] * q[1] + m[10] * q[2];
    return z > .05 ? [fx * x / z + cx, fy * y / z + cy] : null;
  }
  const RED = '#f42738', NEW = '#f39442';
  let placed = [];   // labels drawn this frame: a new one steps down until it is clear of them
  function label(x, y, s) {
    ctx.font = '500 10.5px "Geist Mono", monospace';
    const w = ctx.measureText(s).width + 10;
    x = Math.min(632 - w, Math.max(8, x));
    for (let k = 0; k < 4 && placed.some(b => x - 5 < b[0] + b[2] && b[0] < x - 5 + w && Math.abs(b[1] - y) < 17); k++) y += 18;
    placed.push([x - 5, y, w]);
    ctx.fillStyle = 'rgba(18,18,17,.62)';
    ctx.beginPath(); ctx.roundRect(x - 5, y - 11, w, 16, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(s, x, y + 1);
  }
  function arrow(a, b, w) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, h = Math.min(8, len * .4);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b);
    ctx.moveTo(b[0] - h * (ux - uy * .5), b[1] - h * (uy + ux * .5)); ctx.lineTo(...b); ctx.lineTo(b[0] - h * (ux + uy * .5), b[1] - h * (uy - ux * .5));
    ctx.stroke();
  }
  function overlay(t, f) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr * r.width / 640, 0, 0, dpr * r.width / 640, 0, 0);
    ctx.clearRect(0, 0, 640, 480);
    ctx.lineCap = ctx.lineJoin = 'round';
    placed = [];
    const bodies = Object.entries(data.bodies);
    // trails: the path so far, older parts fainter
    for (const [, b] of bodies) {
      if (!b.trail) continue;
      let prev = null;
      for (let i = 0; i <= f; i++) {
        const p = project(f, b.com[i]);
        if (p && prev) {
          ctx.strokeStyle = `rgba(244,39,56,${(.22 + .68 * Math.max(0, 1 - (f - i) / 72)).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(...prev); ctx.lineTo(...p); ctx.stroke();
        }
        prev = p;
      }
    }
    // bounces: a tick at every apex reached and the restitution the first rebound implies
    for (const [id, bb] of Object.entries(data.bounce || {})) {
      const b = data.bodies[id];
      for (const a of bb.apex.filter(a => a <= f)) {
        const p = project(f, b.com[a]);
        if (!p) continue;
        for (const [c, w] of [['rgba(18,18,17,.45)', 3.5], ['#fff', 1.5]]) {   // a dark edge keeps it visible on a white wall
          ctx.strokeStyle = c; ctx.lineWidth = w;
          ctx.beginPath(); ctx.moveTo(p[0] - 9, p[1]); ctx.lineTo(p[0] + 9, p[1]); ctx.stroke();
        }
      }
      if (bb.apex.length && f >= bb.apex[0]) {
        const p = project(f, b.com[f]);
        if (p) label(p[0] + 22, p[1] + 4, `e ${bb.e.toFixed(2)}`);
      }
    }
    // velocity: an arrow for where the centre of mass is heading
    for (const [id, b] of bodies) {
      if (!b.arrow) continue;
      const c = b.com[f], v = b.vel[f], s = Math.hypot(...v);
      if (s < .05) continue;
      const a = project(f, c), e = project(f, c.map((x, k) => x + v[k] * data.arrow_s));
      if (!a || !e || Math.hypot(e[0] - a[0], e[1] - a[1]) < 6) continue;
      ctx.strokeStyle = RED;
      arrow(a, e, 2.2);
      ctx.fillStyle = RED; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(...a, 3.5, 0, 7); ctx.fill(); ctx.stroke();
      if (id === data.label) label(e[0] + 10, e[1] + 4, `${b.name} ${s.toFixed(1)} m/s`);
    }
    // contacts: a ring where they touch; the strongest two of the moment are named with their peak force
    const live = data.contacts.filter(c => c.n >= 30 && t >= c.t && t - c.t < RING);
    for (const c of live) {
      const p = project(f, c.p), age = (t - c.t) / RING;
      if (!p) continue;
      ctx.strokeStyle = `rgba(243,148,66,${(1 - age).toFixed(2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(...p, 5 + age * 22 * Math.min(1.6, Math.log10(c.n) / 3), 0, 7); ctx.stroke();
    }
    for (const c of [...live].sort((a, b) => b.n - a.n).slice(0, 2)) {
      const p = project(f, c.p);
      if (p) label(p[0] + 12, p[1] - 12, `${c.pair.join(' → ')} · ${force(c.n)}`);
    }
    for (const [id, bb] of Object.entries(data.bounce || {})) {
      for (const h of bb.hits) {
        const age = (t - h / data.fps) / RING;
        if (age < 0 || age >= 1) continue;
        const c = data.bodies[id].com[h], p = project(f, [c[0], c[1], 0]);
        if (!p) continue;
        ctx.strokeStyle = `rgba(243,148,66,${(1 - age).toFixed(2)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(...p, 6 + age * 26, 2 + age * 7, 0, 0, 7); ctx.stroke();
      }
    }
  }

  function draw(t, redraw) {
    if (!chart) return;
    const c = chart, f = Math.min(data.frames - 1, Math.max(0, Math.round(t * data.fps)));
    // gravity eases to its new value, so a switch reads as a change rather than a jump
    g += (data.g[f] - g) * (redraw ? 1 : .12);
    gauge.arrow.setAttribute('y2', (20 + 13 * g / 9.81).toFixed(2));
    gauge.arrow.style.opacity = g > .05 ? 1 : 0;
    gauge.text.textContent = g > .05 ? `g ${data.g[f].toFixed(2)} m/s²` : 'g 0';
    gauge.box.classList.toggle('moon', data.g[f] > .05 && data.g[f] < 9);
    overlay(t, f);
    if (f === c.lastF && !redraw) return;
    c.lastF = f;
    const x = c.X(f / data.fps);
    c.past.setAttribute('width', x);
    c.head.setAttribute('x1', x);
    c.head.setAttribute('x2', x);
    for (const row of c.rows) {
      row.dot.setAttribute('cx', x);
      row.dot.setAttribute('cy', row.y(row.v[f]));
      row.val.textContent = row.text(f);
    }
    const latest = c.stems.filter(s => s.t <= t && s.n).at(-1);
    c.last.textContent = latest ? force(latest.n) : '';
    const parts = [`sim ${data.sim[f].toFixed(2)} s`];
    if (data.down) parts.push(`${data.down.label} ${data.down.n[f]} / ${data.down.of}`);
    hud.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
  }

  // one clock: the rendering leads, the small simulation follows it
  function tick() {
    if (!visible) return;
    requestAnimationFrame(tick);
    if (!data || !deck.out.duration) return;
    const t = deck.now();
    // a clip rendered in slow motion plays once at real speed (sped up where it was slowed), then as rendered, saying how slow
    if (data.slow) {
      if (lastT > deck.out.duration - 1 && t < 1) pass = 1 - pass;
      const r = data.rate[Math.min(data.frames - 1, Math.round(t * data.fps))], want = !pass && r < .99 ? Math.min(4, 1 / r) : 1;
      if (Math.abs(deck.out.playbackRate - want) > .02) deck.out.playbackRate = deck.sim.playbackRate = want;
      const slow = !!pass && r < .9;
      if (slow && !slowTag.classList.contains('on')) slowTag.textContent = `Slow motion · ${Math.min(...data.rate).toFixed(2)}×`;
      slowTag.classList.toggle('on', slow);
    }
    lastT = t;
    if (!deck.out.paused && !deck.out.seeking && deck.sim.readyState >= 2 && !deck.sim.seeking && Math.abs(deck.sim.currentTime - t) > .1) deck.sim.currentTime = t;
    draw(t);
  }

  // scrub on the chart
  plot.addEventListener('pointerdown', e => {
    if (!data) return;
    plot.setPointerCapture(e.pointerId);
    deck.out.pause();
    deck.sim.pause();
    const seek = e => {
      const r = plot.getBoundingClientRect(), T = data.frames / data.fps;
      const t = Math.min(T - .02, Math.max(0, (e.clientX - r.left - L.name) / (r.width - L.name - L.value) * T));
      [deck.out, deck.sim].forEach(v => seekVideo(v, t));
      draw(t, true);
    };
    seek(e);
    plot.onpointermove = seek;
    plot.onpointerup = plot.onpointercancel = () => { plot.onpointermove = null; if (inView) play(); };
  });

  // hover the photo to see it larger
  photo.addEventListener('mouseenter', () => {
    peekImg.src = photo.src;
    const o = stage.getBoundingClientRect(), r = photo.getBoundingClientRect(), w = peekBox.offsetWidth, h = w * .75;
    peekBox.style.left = `${Math.min(o.width - w - 12, r.right - o.left + 14)}px`;
    peekBox.style.top = `${Math.max(12, Math.min(o.height - h - 12, r.top - o.top + r.height / 2 - h / 2))}px`;
    peekBox.classList.add('on');
  });
  photo.addEventListener('mouseleave', () => peekBox.classList.remove('on'));

  new ResizeObserver(() => { if (data && chart) { build(); draw(deck.now(), true); } }).observe(plot);
  // the overlay follows the clock once the figure is near; the videos play only once half the screen is in view
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) requestAnimationFrame(tick);
  }, {rootMargin: '120px 0px'}).observe(screen);
  new IntersectionObserver(([e]) => {
    inView = e.intersectionRatio >= .5;
    if (!inView) return decks.forEach(d => { d.out.pause(); d.sim.pause(); });
    if (deck.out.src) play();
  }, {threshold: [0, .5]}).observe(screen);
  show(0);
}
