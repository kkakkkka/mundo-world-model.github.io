// Start playback independently of preloading; metadata only controls seeking.
const pendingSeeks = new WeakMap();

export function seekVideo(video, time) {
  pendingSeeks.get(video)?.();
  const cancel = () => {
    video.removeEventListener('loadedmetadata', seek);
    pendingSeeks.delete(video);
  };
  const seek = () => {
    if (video.readyState < 1) return;
    cancel();
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - .04) : time;
    const target = Math.max(0, Math.min(time, end));
    // A no-op seek need not fire seeked. Nothing waits for that event.
    if (Math.abs(video.currentTime - target) > .01) video.currentTime = target;
  };
  pendingSeeks.set(video, cancel);
  video.addEventListener('loadedmetadata', seek);
  seek();
}

export function prepareVideo(video, src, time = 0, preload = 'auto') {
  pendingSeeks.get(video)?.();
  video.pause();
  video.muted = true;
  video.playsInline = true;
  video.preload = preload;
  if (video.src !== new URL(src, location.href).href) {
    video.src = src;
    video.load();
  }
  seekVideo(video, time);
}

// One gesture starts every video in the active comparison, including its proxy.
export function videoPlayback(container, getVideos) {
  const containers = Array.isArray(container) ? container : [container];
  const buttons = containers.map(el => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-play';
    button.textContent = 'Play video';
    button.hidden = true;
    el.append(button);
    return button;
  });
  const showButton = show => buttons.forEach(button => button.hidden = !show);
  let revision = 0;
  const blocked = new WeakSet(), pending = new WeakMap();
  const play = (gesture = false) => {
    const current = revision;
    for (const video of getVideos()) {
      if (!video.getAttribute('src')) continue;
      if (gesture) blocked.delete(video);
      if (blocked.has(video) || !video.paused) continue;
      const src = video.src, prior = pending.get(video);
      if (prior?.revision === current && prior.src === src) continue;
      const request = {revision: current, src};
      pending.set(video, request);
      video.muted = true;
      video.playsInline = true;
      video.play().catch(error => {
        if (revision !== current || video.src !== src || !getVideos().includes(video) || error.name === 'AbortError') return;
        blocked.add(video);
        showButton(true);
        console.warn('Video playback failed:', video.currentSrc || video.src, error);
      }).finally(() => {
        if (pending.get(video) === request) pending.delete(video);
      });
    }
  };
  // The comparison's drag/swap handlers must not intercept this button.
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.stopPropagation();
      for (const video of getVideos()) if (video.error) video.load();
      play(true);
    });
  }
  const update = () => {
    if (getVideos().every(v => !v.paused && v.readyState >= 2 && !v.error)) showButton(false);
  };
  // Companion videos can live outside the output container.
  const root = containers[0].closest('figure') || containers[0];
  for (const video of root.querySelectorAll('video')) {
    video.addEventListener('playing', () => { blocked.delete(video); update(); });
    video.addEventListener('error', () => {
      if (!getVideos().includes(video)) return;
      showButton(true);
      console.warn('Video load failed:', video.currentSrc || video.src, video.error);
    });
  }
  return {
    play,
    pause() { getVideos().forEach(v => v.pause()); },
    reset() { revision++; getVideos().forEach(v => blocked.delete(v)); showButton(false); },
  };
}
