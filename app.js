// Page chrome and media components: nav, reveals, lazy video, the demo film.
import {seekVideo, videoPlayback} from './media.js?v=20261023-mobile-all-2';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ── reveal on scroll ──
const reveal = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  reveal.unobserve(e.target);
}), {rootMargin: '0px 0px -8% 0px'});
$$('.intro > *, .film-sec, .chapter-head, .sub > h3, .sub > .cols, .fig, .explorer, .navfig, .manip, .phys, .floorfig, .trio, .cols3, .cite, .narrow').forEach(el => {
  el.classList.add('reveal');
  reveal.observe(el);
});

// ── an image that is not ready yet stays hidden, instead of showing the browser's alt text, broken-image icon or a
// half-drawn file, and fades in once loaded; one that fails stays hidden. An image already on screen keeps showing
// while a new source loads (the browser holds the old picture), so only images with nothing shown yet are held. ──
const shown = new WeakSet();
const hold = img => { if (!shown.has(img) && (!img.getAttribute('src') || !img.complete || !img.naturalWidth)) img.classList.add('wait'); };
document.addEventListener('load', e => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  shown.add(img);
  if (!img.classList.contains('wait')) return;
  img.classList.replace('wait', 'ready');
  setTimeout(() => img.classList.remove('ready'), 400);
}, true);
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('wait'); }, true);
$$('img').forEach(img => img.complete && img.naturalWidth ? shown.add(img) : hold(img));
new MutationObserver(ms => ms.forEach(m => {
  if (m.type === 'attributes') { if (m.target.tagName === 'IMG') hold(m.target); return; }
  m.addedNodes.forEach(n => n.nodeType === 1 && (n.tagName === 'IMG' ? [n] : n.querySelectorAll('img')).forEach(hold));
})).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['src']});

// ── videos load (and show their poster) once near, and play only while at least half of them is in view ──
// (as for the 3D figures, a video the page only scrolls past is not loaded: it must stay near for a moment)
const nearBy = new Map();
const near = new IntersectionObserver(es => es.forEach(e => {
  const v = e.target;
  clearTimeout(nearBy.get(v));
  if (e.isIntersecting) nearBy.set(v, setTimeout(() => {
    if (v.dataset.poster) v.poster = v.dataset.poster;
    if (v.preload === 'none') v.preload = 'auto';
    near.unobserve(v);
  }, 250));
}), {rootMargin: '400px 0px'});
const lazyPlayers = new Map();
const lazy = new IntersectionObserver(es => es.forEach(e => e.intersectionRatio >= .5 ? lazyPlayers.get(e.target).play() : e.target.pause()),
  {threshold: [0, .5]});

// ── demo film: plays with sound on click; while it plays the page dims and the film's colours glow at its edges ──
const film = $('[data-film]');
if (film) {
  const sec = film.closest('.film-sec'), v = $('video', film), glow = $('.film-glow', sec), gx = glow.getContext('2d');
  const playFilm = () => v.play().catch(error => {
    if (error.name === 'AbortError') return;
    v.muted = true;
    return v.play();
  }).catch(error => {
    sec.classList.add('paused');
    console.warn('Demo film playback failed:', error);
  });
  const start = () => {
    sec.classList.add('started');
    v.muted = false;
    playFilm();
  };
  const toggle = () => !sec.classList.contains('started') ? start() : v.paused ? playFilm() : v.pause();
  $('.film-start', film).addEventListener('click', () => sec.classList.contains('started') ? playFilm() : start());
  v.addEventListener('click', toggle);
  sec.addEventListener('click', e => { if (e.target === sec) v.pause(); });   // a click in the dark around the film
  $('.film-mute', film).addEventListener('click', () => v.muted = !v.muted);
  $('.film-full', film).addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen();
      else if (film.requestFullscreen) await film.requestFullscreen();
      else v.webkitEnterFullscreen?.();
    } catch (error) { console.warn('Demo film fullscreen failed:', error); }
  });
  const draw = () => {
    sec.classList.toggle('paused', v.paused);
    sec.classList.toggle('muted', v.muted);
    sec.classList.toggle('dark', sec.classList.contains('started') && !v.paused);
  };
  ['play', 'pause', 'volumechange'].forEach(ev => v.addEventListener(ev, draw));
  v.addEventListener('ended', () => { sec.classList.remove('started'); v.currentTime = 0; draw(); });
  // its cover (the title card, over the film while it is at rest) and its length (for the seek bar) are asked for once the section
  // is near, not with the page
  const cover = $('.film-cover', film);
  new IntersectionObserver(([e], io) => {
    if (!e.isIntersecting) return;
    cover.src = cover.dataset.src;
    v.preload = 'metadata';
    io.disconnect();
  }, {rootMargin: '600px'}).observe(film);
  // seek bar along the bottom edge: follows playback, click or drag (or arrow keys) to move through the film
  const seek = $('.film-seek', film), fill = $('span', seek);
  const shown = () => {
    const k = v.duration ? v.currentTime / v.duration : 0;
    fill.style.transform = `scaleX(${k.toFixed(4)})`;
    seek.setAttribute('aria-valuenow', Math.round(k * 100));
  };
  let n = 0;
  const tick = () => {
    shown();
    if (n++ % 4 === 0 && v.readyState >= 2) gx.drawImage(v, 0, 0, glow.width, glow.height);   // the glow: the frame at 32 × 18
    if (!v.paused) requestAnimationFrame(tick);
  };
  v.addEventListener('play', tick);
  v.addEventListener('seeked', shown);
  const to = e => {
    const r = seek.getBoundingClientRect();
    if (v.duration) seekVideo(v, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration);
    shown();
  };
  seek.addEventListener('pointerdown', e => { seek.setPointerCapture(e.pointerId); to(e); seek.onpointermove = to; });
  for (const event of ['pointerup', 'pointercancel']) seek.addEventListener(event, () => seek.onpointermove = null);
  seek.addEventListener('keydown', e => {
    const d = {ArrowLeft: -5, ArrowRight: 5}[e.key];
    if (d && v.duration) { e.preventDefault(); seekVideo(v, v.currentTime + d); }
  });
  // scrolled away, the film pauses and the section settles back; it resumes where it left off
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) return;
    v.pause();
    sec.classList.remove('started');
    draw();
  }, {threshold: .2}).observe(film);
}

$$('video.lazy').filter(v => !v.closest('#pipeline')).forEach(v => {
  lazyPlayers.set(v, videoPlayback(v.parentElement, () => [v]));
  near.observe(v); lazy.observe(v);
});

// ── context views: one camera path rendered from 1, 3 or 9 views, picked on a slider; the switch keeps the moment and dims the photos not in use ──
const views = $('#views');
if (views) {
  const vids = $$('video', views), photos = $$('.views-photos img', views), track = $('.vs-track', views), labels = $$('.vs-labels button', views);
  const counts = [1, 3, 9], used = [[0], [0, 6, 8], [0, 1, 2, 3, 4, 5, 6, 7, 8]];
  let on = 0, showing = 0, visible = false, pending = null;
  const playback = videoPlayback($('.views-screen', views), () => [pending?.video || vids[showing]]);
  // A selection can arrive before metadata, or seek to the same time. Neither
  // guarantees a seeked event, so readiness and seeking both drive the swap.
  const present = () => {
    if (!pending) return;
    const request = pending, to = request.video;
    if (visible) playback.play();
    if (to.readyState < 1) return;
    if (!request.synced) {
      request.synced = true;
      const time = Number.isFinite(to.duration) ? Math.min(request.time, Math.max(0, to.duration - .04)) : request.time;
      if (Math.abs(to.currentTime - time) > .04) to.currentTime = time;
    }
    if (to.seeking || to.readyState < 2) return;
    pending = null;
    showing = on;
    vids.forEach(v => { v.classList.toggle('on', v === to); if (v !== to) v.pause(); });
    views.removeAttribute('aria-busy');
    if (visible) playback.play();
    else to.pause();
  };
  for (const v of vids) for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'playing', 'timeupdate']) v.addEventListener(event, present);
  const pick = k => {
    if (k === on) return;
    const time = vids[showing].currentTime, to = vids[k];
    on = k;
    // Replace the pending request; late events always inspect the latest choice.
    pending = {video: to, time, synced: false};
    playback.reset();
    vids.forEach(v => v.pause());
    to.preload = 'auto';
    views.setAttribute('aria-busy', 'true');
    track.setAttribute('aria-valuenow', counts[k]);
    track.setAttribute('aria-valuetext', `${counts[k]} view${k ? 's' : ''}`);
    labels.forEach((b, j) => b.classList.toggle('on', j === k));
    photos.forEach((im, j) => im.classList.toggle('off', !used[k].includes(j)));
    present();
  };
  // the knob follows the pointer and the video follows the nearest stop; on release the knob settles on it
  const knob = p => track.style.setProperty('--p', p);
  const at = e => { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    track.classList.add('drag');
    const move = e => { const p = at(e); knob(p); pick(Math.round(p * 2)); };
    move(e);
    track.onpointermove = move;
    track.onpointerup = track.onpointercancel = () => { track.onpointermove = null; track.classList.remove('drag'); knob(on / 2); };
  });
  track.addEventListener('keydown', e => {
    const d = {ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1}[e.key];
    if (!d) return;
    e.preventDefault();
    pick(Math.min(2, Math.max(0, on + d)));
    knob(on / 2);
  });
  labels.forEach((b, k) => b.addEventListener('click', () => { pick(k); knob(k / 2); }));
  new IntersectionObserver(([e]) => { if (e.isIntersecting) vids.forEach(v => v.preload = 'auto'); }, {rootMargin: '400px 0px'}).observe(views);
  new IntersectionObserver(([e]) => {
    visible = e.intersectionRatio >= .5;
    if (!visible) return vids.forEach(v => v.pause());
    if (pending) present();
    else playback.play();
  }, {threshold: [0, .5]}).observe($('.views-screen', views));
}

// ── copy BibTeX ──
for (const btn of $$('[data-copy]')) btn.addEventListener('click', async () => {
  await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
  btn.textContent = 'Copied';
  setTimeout(() => btn.textContent = 'Copy', 1600);
});

