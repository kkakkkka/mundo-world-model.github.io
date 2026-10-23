// Shared Hotel scene data and helpers.
import * as THREE from 'three';
import {decodeCloud, cloudFile} from './space.js';

// the proxy palette.
export const PALETTE = {object: '#eeeeee', new_object: '#f39442', floor: '#707070', wall: '#a9b6c6',
  ceiling: '#bba2dc', window: '#56c8d8', door: '#ad7756', unknown: '#30343b'};

export function proxyColor(part) {
  if (part.layer === 'wall' || part.layer === 'floor' || part.layer === 'ceiling') return PALETTE[part.layer];
  // as the proxy renderer: a glass door is drawn as a door, a fixed glass panel as an object
  if (part.category === 'door' || part.category === 'glass_door') return PALETTE.door;
  if (part.category === 'window') return PALETTE.window;
  return PALETTE.object;
}

// one colour per kind of object for the box views (the hero's reconstruction step, 5.1), not the proxy palette
const BOX = {bed: '#a591ef', desk: '#ef936d', chair: '#e98bac', armchair: '#e98bac', bedside_table: '#e6bd65', side_table: '#e6bd65',
  cabinet: '#e6bd65', vanity: '#e6bd65', curtain: '#85aedf', window: '#72cbb0', glass_door: '#72cbb0', mirror: '#72cbb0', door: '#d79a6b',
  television: '#58b9ee', picture: '#58b9ee', toilet: '#aec976', shower: '#aec976', trash_bin: '#aec976', electric_kettle: '#aec976'};
const SAME = {nightstand: 'bedside_table', painting: 'picture', tv: 'television', sofa: 'armchair', shoe_cabinet: 'cabinet', washing_cabinet: 'cabinet',
  bathroom_cabinet: 'cabinet', shower_room: 'shower'};   // other names for the same things
export const boxColor = c => { const k = c.toLowerCase().replace(/[\s-]+/g, '_'); return new THREE.Color(BOX[SAME[k] ?? k] ?? '#b7b3a8'); };
let meta, layout, full;
export const storyMeta = () => meta ??= fetch('story/story.json').then(r => r.json());
const get = (f, kind) => fetch('story/' + f).then(r => r[kind]());

// the scene's layout first (the hero starts on it), then the points (decodeCloud: as built or as published)
export const loadStoryLayout = () => layout ??= Promise.all([storyMeta(), get('geometry.json', 'json'), get('boxer.json', 'json')])
  .then(([story, geometry, boxer]) => ({story, geometry, boxer}));
export function loadStory() {
  return full ??= (async () => {
    const points = (await storyMeta()).points;
    const [{story, geometry, boxer}, q, c, f] = await Promise.all([loadStoryLayout(),
      ...['points.bin', 'colors.bin', 'frames.bin'].map(name => get(cloudFile(points, name), 'arrayBuffer'))]);
    const {positions, colors, extra: [frames]} = decodeCloud(story.points, q, c, new Uint8Array(f));
    return {story, geometry, boxer, positions, colors, frames};
  })();
}

// OpenCV camera-to-world → three.js camera world matrix.
const FLIP = new THREE.Matrix4().makeScale(1, -1, -1);
export const cvToThree = c2w => new THREE.Matrix4().set(...c2w.flat()).multiply(FLIP);

// Pinhole intrinsics in canvas pixels → three.js projection matrix.
export function projectionFromK(fx, fy, cx, cy, W, H, near = 0.03, far = 120) {
  return new THREE.Matrix4().set(
    2 * fx / W, 0, 1 - 2 * cx / W, 0,
    0, 2 * fy / H, 2 * cy / H - 1, 0,
    0, 0, -(far + near) / (far - near), -2 * far * near / (far - near),
    0, 0, -1, 0);
}

export function partGeometry(part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices.flat(), 3));
  g.setIndex(part.faces.flat());
  return g;
}

export function pointGeometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true));
  return g;
}
