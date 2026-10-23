// Page navigation, built on the article's own anchors (the links in #contents-panel).
// Wide screens: a route down the left margin, one stop per chapter (a box, as in the logo) and per section (a dot), filled blue
// as far as you have read; only the chapter being read lists its sections. The current chapter and section are named,
// Text passages reveal the labels; media collapses them to the route markers.
// Hovering or focusing the route reveals its labels, and a click goes there.
// Narrow screens: the same links in a Contents panel under the top bar. The top bar names the chapter and section being read.
const rail = document.querySelector('.contents');
const panel = document.querySelector('#contents-panel');
const mobileButton = document.querySelector('.contents-mobile');
const bar = document.querySelector('.topbar');
const title = document.querySelector('.reading-title');
const desktop = matchMedia('(min-width: 1280px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const links = [...panel.querySelectorAll('a[href^="#"]')];
const entries = links.map(link => ({link, target: document.querySelector(link.hash)}));
let current = '', openGroup, chosenAnchor = null, chosenDestination = 0;
const textPassages = [...document.querySelectorAll(
  '.intro, .chapter-head, .sub > h3, .sub > .cols, .sub > .narrow'
)];
const mediaPassages = [...document.querySelectorAll(
  'main figure, main aside, main video, main canvas, main img, main svg, main math, main [role="img"], main .film-sec, main [data-toc-collapse]'
)];

function updateReadingMode() {
  if (!desktop.matches) return;
  const closing = document.getElementById('citation');   // the page's last section (the references moved to the blog)
  if (closing && closing.getBoundingClientRect().top <= innerHeight * .7) {
    rail.dataset.readingText = 'false';
    return;
  }
  // Protect the full visible height of the navigation, not a single reading line.
  const bounds = route.getBoundingClientRect();
  const top = Math.max(80, bounds.top);
  const bottom = Math.min(innerHeight - 40, bounds.bottom);
  if (bottom <= top) {
    rail.dataset.readingText = 'false';
    return;
  }
  // Close before visual content reaches the rail; require more space to reopen.
  const clearance = rail.dataset.readingText === 'true' ? 100 : 150;
  const visualNearby = mediaPassages.some(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 &&
      box.top < bottom + clearance && box.bottom > top - clearance;
  });
  if (visualNearby) {
    rail.dataset.readingText = 'false';
    return;
  }
  // Merge text intervals so nested or overlapping blocks are counted only once.
  const intervals = textPassages.map(element => element.getBoundingClientRect())
    .filter(box => box.width > 0 && box.bottom > top && box.top < bottom)
    .map(box => [Math.max(top, box.top), Math.min(bottom, box.bottom)])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, end = top;
  for (const [start, stop] of intervals) {
    covered += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  rail.dataset.readingText = String(covered / (bottom - top) >= .65);
}

// ── the route ──
const route = document.createElement('ol'), fill = document.createElement('li');
route.className = 'route';
fill.className = 'route-fill';
fill.setAttribute('aria-hidden', 'true');
route.append(fill);
for (const e of entries) {
  const chapter = e.target.matches('section.chapter');
  e.kind = chapter ? 'chapter' : e.target.closest('section.chapter') ? 'section' : 'part';
  const li = document.createElement('li'), a = document.createElement('a');
  li.className = `stop is-${e.kind}`;   // (not .chapter: that is the page's chapter section)
  a.href = e.link.hash;
  a.innerHTML = (chapter ? `<em>${e.target.querySelector('.chapter-no').textContent}</em>` : '') + `<span>${e.link.textContent}</span>`;
  li.append(a);
  route.append(li);
  e.stop = li;
  e.routeLink = a;
}
rail.prepend(route);

// ── the narrow screens' panel ──
function open(value) {
  rail.dataset.open = String(value);
  panel.inert = !value;
  mobileButton.setAttribute('aria-expanded', String(value));
}
const close = () => open(false);
mobileButton.addEventListener('click', () => open(rail.dataset.open !== 'true'));
document.addEventListener('pointerdown', e => { if (!rail.contains(e.target) && !mobileButton.contains(e.target)) close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && rail.dataset.open === 'true') { close(); mobileButton.focus(); } });
desktop.addEventListener('change', close);

// ── what is being read: the route's stops, the panel's links and the top bar's title ──
// the chapter's title, then the section's, as their headings read (without their numbers)
function titleOf(target, link) {
  const chapter = target.closest('section.chapter');
  if (!chapter) return [link.textContent];
  const name = chapter.querySelector('h2').textContent;
  if (target === chapter) return [name];
  const h3 = target.matches('.sub') && target.querySelector('h3');
  return [name, h3 ? [...h3.childNodes].filter(n => n.nodeName !== 'SPAN').map(n => n.textContent).join('').trim() : link.textContent];
}
function markCurrent(id) {
  if (id === current) return;
  current = id;
  const k = entries.findIndex(e => e.target.id === id), active = entries[k];
  entries.forEach((e, j) => {
    e.stop.classList.toggle('on', j === k);
    e.stop.classList.toggle('past', j < k);
    if (j === k) { e.link.setAttribute('aria-current', 'location'); e.routeLink.setAttribute('aria-current', 'location'); }
    else { e.link.removeAttribute('aria-current'); e.routeLink.removeAttribute('aria-current'); }
  });
  const group = active?.link.dataset.group;
  for (const li of panel.querySelectorAll('.contents-list > li')) li.dataset.active = String(li.firstElementChild.dataset.group === group);
  // the route opens the chapter being read; the line follows its sections as they unfold
  if (group !== openGroup) {
    openGroup = group;
    entries.forEach(e => e.stop.classList.toggle('open', e.link.dataset.group === group));
    const until = performance.now() + 450, follow = () => { updateFill(); if (performance.now() < until) requestAnimationFrame(follow); };
    requestAnimationFrame(follow);
  }
  // chapter, then section; the last one is underlined, and the line draws in again whenever it changes
  const parts = active ? titleOf(active.target, active.link) : [];
  title.innerHTML = parts.map((name, j) => `<span class="rt${j === parts.length - 1 ? ' now' : ''}">${name}</span>`).join('');
}
function updateFill() {
  if (!desktop.matches) return;
  // the filled line runs between the stops as the page runs between their headings
  const line = 132, tops = entries.map(e => e.target.getBoundingClientRect().top);
  let i = 0;
  tops.forEach((t, j) => { if (t <= line) i = j; });
  const j = Math.min(i + 1, entries.length - 1), y = e => e.stop.offsetTop + e.stop.offsetHeight / 2;
  const k = j === i ? 0 : Math.min(1, Math.max(0, (line - tops[i]) / (tops[j] - tops[i])));
  // the line itself runs from the first stop to the last; the filled part from the first to here
  route.style.setProperty('--start', `${y(entries[0])}px`);
  route.style.setProperty('--end', `${y(entries.at(-1))}px`);
  route.style.setProperty('--fill', `${(y(entries[i]) + (y(entries[j]) - y(entries[i])) * k - y(entries[0])).toFixed(1)}px`);
}
function updateReadingPosition() {
  const line = 132;
  let id = entries[0].target.id;
  for (const {target} of entries) if (target.getBoundingClientRect().top <= line) id = target.id;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 3) id = entries.at(-1).target.id;
  markCurrent(chosenAnchor || id);
  updateReadingMode();
  const reading = document.querySelector('#story').getBoundingClientRect().bottom <= 120;
  bar.classList.toggle('scrolled', reading);
  rail.dataset.visible = String(reading);
}
let queued = false;
addEventListener('scroll', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; updateReadingPosition(); updateFill(); });
}, {passive: true});
// Observe tall sections as well as their headings, so long demos and large jumps
// retain their section until the next heading reaches the reading line.
const observer = new IntersectionObserver(updateReadingPosition, {rootMargin: '-80px 0px -65% 0px', threshold: [0, 1]});
for (const {target} of entries) {
  observer.observe(target);
  const h = target.querySelector('h2,h3');
  if (h) observer.observe(h);
}
observer.observe(document.querySelector('#story'));
observer.observe(document.querySelector('.footer'));
addEventListener('resize', () => { chosenAnchor = null; updateReadingPosition(); updateFill(); });
// Figures load on the way to a chosen heading and can move it; when the scroll ends, settle on it again
// (at most twice, and not at the page end, where it cannot be reached). Wheel, touch and keys clear the choice first.
let settles = 0;
addEventListener('scrollend', () => {
  if (chosenAnchor) {
    const target = document.getElementById(chosenAnchor), h = target.matches('section.chapter') ? target.querySelector('h2') : target;
    const off = h.getBoundingClientRect().top - 88, end = scrollY >= document.documentElement.scrollHeight - innerHeight - 3;
    if (Math.abs(off) > 3 && !end && settles < 2) { settles++; goTo(target, reduced.matches ? 'instant' : 'smooth'); return; }
    if (Math.abs(off) > 3 && !end) chosenAnchor = null;
  }
  updateReadingPosition();
});
// Keep an explicitly selected heading active even when the page end clamps its
// scroll position. Reading resumes as soon as the user scrolls again.
const resumeReading = () => { chosenAnchor = null; updateReadingPosition(); };
addEventListener('wheel', resumeReading, {passive:true});
addEventListener('touchmove', resumeReading, {passive:true});
addEventListener('keydown', e => {
  if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key) && !rail.contains(e.target)) resumeReading();
});

function goTo(target, behavior, focus = false) {
  chosenAnchor = target.id;
  // Section containers include editorial top spacing; align the actual heading.
  const h = target.matches('section.chapter') ? target.querySelector('h2') : target;
  const y = scrollY + h.getBoundingClientRect().top - 88;
  chosenDestination = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
  window.scrollTo({top: chosenDestination, behavior});
  markCurrent(target.id);
  if (focus) {
    const focusTarget = target.querySelector('h2,h3') || target;
    if (!focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1;
    focusTarget.focus({preventScroll:true});
  }
}
for (const {link, routeLink, target} of entries) for (const a of [link, routeLink]) a.addEventListener('click', e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  close();
  history.pushState(null, '', a.hash);
  settles = 0;
  goTo(target, reduced.matches ? 'instant' : 'smooth', true);
});
function hashTarget() {
  try { return document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return null; }
}
addEventListener('hashchange', () => { const target = hashTarget(); if (target) goTo(target, 'instant'); });
addEventListener('popstate', () => { const target = hashTarget(); if (target) goTo(target, 'instant'); });
// A direct deep link remains aligned while fonts and media establish their sizes.
const initialTarget = hashTarget();
if (initialTarget) {
  let tracking = true;
  const align = () => { if (tracking) goTo(initialTarget, 'instant'); };
  const resizes = new ResizeObserver(align);
  resizes.observe(document.querySelector('main'));
  const stop = () => { tracking = false; resizes.disconnect(); };
  for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) addEventListener(event, stop, {once:true, passive:true});
  document.fonts.ready.then(align);
  addEventListener('load', align, {once:true});
  setTimeout(stop, 8000);
  align();
}
updateReadingPosition();
updateFill();
