// 2.3 Space-time simulation: under each clip, its time line from media/space-time.json, marking the bullet-time stretches
// where time stops, with a playhead; a tag on the clip shows while one plays. Click or drag a line to move through it.
import {seekVideo} from './media.js?v=20261023-mobile-all-2';
const root = document.getElementById('spacetime');
if (root) fetch('media/space-time.json').then(r => r.json()).then(init);

function init(cases) {
  const tiles = [...root.querySelectorAll('[data-st]')].map(el => {
    const c = cases.find(x => x.id === el.dataset.st), v = el.querySelector('video'), bar = el.querySelector('.st-time'), tag = el.querySelector('.st-tag');
    const segs = c.segments.map(s => {
      const seg = document.createElement('span'), at = k => `${(k / c.frames * 100).toFixed(3)}%`;
      seg.className = `seg ${s.kind}`;
      // a hair of space between the parts
      seg.style.left = `calc(${at(s.a)} + 1.5px)`;
      seg.style.width = `calc(${at(s.b - s.a)} - 3px)`;
      seg.append(document.createElement('i'));
      bar.append(seg);
      const text = s.kind === 'frozen' ? 'Bullet time' : null;
      let label = null;
      if (text) {
        label = document.createElement('b');
        label.className = s.kind;
        label.textContent = text;
        label.style.left = at((s.a + s.b) / 2);
        bar.append(label);
      }
      return {...s, fill: seg.firstChild, label, text};
    });
    const head = document.createElement('span');
    head.className = 'head';
    bar.append(head);
    const t = {c, v, bar, tag, segs, head, last: null};
    // move through the clip: the line maps the whole clip
    const seek = e => {
      const r = bar.getBoundingClientRect();
      if (v.duration) seekVideo(v, Math.min(.999, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration);
      draw(t);
    };
    bar.addEventListener('pointerdown', e => {
      bar.setPointerCapture(e.pointerId);
      seek(e);
      bar.onpointermove = seek;
      bar.onpointerup = bar.onpointercancel = () => bar.onpointermove = null;
    });
    bar.addEventListener('keydown', e => {
      const d = {ArrowLeft: -2, ArrowRight: 2}[e.key];
      if (d && v.duration) { e.preventDefault(); seekVideo(v, v.currentTime + d); draw(t); }
    });
    return t;
  });

  function draw(t) {
    const p = t.v.duration ? t.v.currentTime / t.v.duration : 0, f = p * t.c.frames;
    t.head.style.left = `${(p * 100).toFixed(3)}%`;
    t.bar.setAttribute('aria-valuenow', Math.round(p * 100));
    let now = t.segs[0];
    for (const s of t.segs) {
      s.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, (f - s.a) / (s.b - s.a))).toFixed(4)})`;
      if (f >= s.a) now = s;
    }
    if (now === t.last) return;
    t.last = now;
    for (const s of t.segs) s.label?.classList.toggle('on', s === now);
    // the tag shows during bullet time only
    t.tag.classList.toggle('on', !!now.text);
    t.tag.classList.toggle('frozen', now.kind === 'frozen');
    if (now.text) t.tag.textContent = now.text;
  }

  // the lines follow their clips while the figure is near
  let near = false;
  new IntersectionObserver(([e]) => { near = e.isIntersecting; if (near) requestAnimationFrame(loop); }, {rootMargin: '200px 0px'}).observe(root);
  const loop = () => {
    if (!near) return;
    for (const t of tiles) draw(t);
    requestAnimationFrame(loop);
  };
  for (const t of tiles) draw(t);
}
