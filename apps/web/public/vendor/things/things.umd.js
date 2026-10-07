/*! Things 1.0 (UMD build). Load three.js first, then use window.Things. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('three'));
  else if (typeof define === 'function' && define.amd) define(['three'], factory);
  else root.Things = factory(root.THREE);
}(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';
/*! Things 1.0 — realistic, parametric plush avatars for three.js (r128 – r16x).
 *
 *  const kit = createThings(THREE);
 *  const avatar = kit.mount(element, 'bruno', { state: 'idle' });
 *  avatar.setConfig({ color: '#7FA7E8', hat: 'beanie' });
 *  avatar.setState('waving');      // idle | thinking | talking | excited | sleepy | waving
 *  avatar.setMouth(0.6);           // lip-sync override 0..1 (null = automatic)
 *  avatar.poke();                  // squish + fur ripple
 *
 *  Everything is described by kit.schema, so editors can be generated from it.
 */
function createThings(THREE) {
  if (!THREE || !THREE.WebGLRenderer) throw new Error('Things: pass the three.js module, e.g. createThings(THREE)');
  const V3 = THREE.Vector3, V4 = THREE.Vector4, PI = Math.PI;

  // ------------------------------------------------------------------ utils
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function flatBottom(dy, top, bottom) { return dy >= 0 ? dy * top : -bottom * (1 - Math.pow(1 + dy, top / bottom)); }
  function hex(h, out) {
    out = out || new V3();
    let s = String(h == null ? '#ffffff' : h).trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const n = parseInt(s.slice(0, 6), 16);
    if (isNaN(n)) return out.set(1, 1, 1);
    return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  function lum(h) { const v = hex(h); return 0.299 * v.x + 0.587 * v.y + 0.114 * v.z; }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function lumpNoise(d, s) {
    return 0.55 * Math.sin(d.x * 2.9 + s) * Math.sin(d.y * 3.3 + s * 1.7) * Math.sin(d.z * 2.6 + s * 0.6)
      + 0.3 * Math.sin(d.x * 6.1 - s * 1.3) * Math.sin(d.y * 5.7 + s * 2.1) * Math.sin(d.z * 6.7 + s)
      + 0.15 * Math.sin(d.x * 11.3 + s * 3.1) * Math.sin(d.y * 12.7 - s) * Math.sin(d.z * 10.1 + s * 0.4);
  }

  // ------------------------------------------------------------------ catalogue
  const SHAPES = {
    round:   { label: 'Round',   lathe: (dy, r) => [r, dy * 0.97], sz: 0.96 },
    wide:    { label: 'Chubby',  lathe: (dy, r) => [r * 1.07, dy * 0.9], sz: 0.96 },
    egg:     { label: 'Egg',     lathe: (dy, r) => [r * (0.86 - 0.1 * dy), dy * 1.16], sz: 0.96 },
    pear:    { label: 'Pear',    lathe: (dy, r) => [r * (0.78 + 0.32 * smooth(0.55, -0.55, dy)), flatBottom(dy, 1.08, 0.86)], sz: 0.95, bottomSeam: -0.86 },
    gumdrop: { label: 'Gumdrop', lathe: (dy, r) => [r * (0.6 + 0.55 * smooth(0.95, -0.5, dy)), flatBottom(dy, 1.1, 0.72)], sz: 0.95, bottomSeam: -0.86 },
    mochi:   { label: 'Mochi',   lathe: (dy, r) => [r * 1.24 * (1 - 0.05 * dy), flatBottom(dy, 0.72, 0.5)], sz: 0.9, bottomSeam: -0.86 },
    ghost:   { label: 'Ghost',   lathe: (dy, r, phi) => {
      if (dy >= 0) return [r, dy * 1.02];
      const sc = 0.11 * (0.5 + 0.5 * Math.cos(6 * phi));
      if (dy > -0.72) return [1, dy * 1.32 + sc * smooth(-0.35, -0.72, dy)];
      const t = smooth(-0.72, -1, dy);
      return [0.98 * (1 - t) + 0.02, -0.95 + sc + 0.3 * t];
    }, sz: 0.94 },
    blob:    { label: 'Blob',    lathe: (dy, r, phi) => [r * 1.16 * (1 + 0.07 * Math.cos(3 * phi + 0.6) * (1 - dy * dy)) * (1 - 0.1 * smooth(0.2, 1, dy)), flatBottom(dy, 0.86, 0.55)], sz: 0.92, bottomSeam: -0.86 },
    drop:    { label: 'Drop',    lathe: (dy, r) => [r * (0.16 + 1.0 * smooth(1.0, -0.5, dy)), flatBottom(dy, 1.34, 0.74)], sz: 0.94, bottomSeam: -0.86 },
    heart:   { label: 'Heart',   fn: (d, out) => {
      const x = d.x * 1.18 * (0.46 + 0.54 * smooth(-1, 0.3, d.y)) * (1 + 0.14 * smooth(0, 0.6, d.y));
      const y = d.y * 0.98 - 0.3 * smooth(0.05, 0.95, d.y) * Math.exp(-d.x * d.x * 9);
      return out.set(x, y, d.z * 0.82);
    }, seamZ: 0 },
    pillow:  { label: 'Pillow', fn: (d, out) => {
      const n = 3.2, s = Math.pow(Math.pow(Math.abs(d.x), n) + Math.pow(Math.abs(d.y), n) + Math.pow(Math.abs(d.z), n), 1 / n);
      return out.set(d.x / s * 1.1, d.y / s * 0.9, d.z / s * 0.6);
    }, seamZ: 0 }
  };
  function shapeFn(sh) {
    if (sh.fn) return sh.fn;
    return function (d, out) {
      const r = Math.sqrt(Math.max(0, 1 - d.y * d.y)); let hx = 0, hz = 0;
      if (r > 1e-6) { hx = d.x / r; hz = d.z / r; }
      const res = sh.lathe(d.y, r, Math.atan2(d.z, d.x));
      return out.set(hx * res[0], res[1], hz * res[0] * (sh.sz || 1));
    };
  }
  function seamFn(sh) {
    const z0 = sh.seamZ != null ? sh.seamZ : -0.04, b = sh.bottomSeam;
    return function (d) { let s = Math.abs(d.z - z0); if (b != null) s = Math.min(s, Math.abs(d.y - b)); return s; };
  }

  const EARS = {
    round:  { label: 'Round',  dir: [0.6, 0.8, 0.05], tilt: 0.55, flop: 0.22, tipY: 0.35, innerZ: 0.07, fn: (d, o) => o.set(d.x * 0.3, d.y * 0.27 + 0.18, d.z * 0.13) },
    pointy: { label: 'Pointy', dir: [0.5, 0.86, 0.0], tilt: 0.42, flop: 0.18, tipY: 0.4, innerZ: 0.07, fn: (d, o) => { const t = Math.pow((d.y + 1) / 2, 1.3), k = 1 - 0.8 * t; return o.set(d.x * 0.27 * k, d.y * 0.26 + 0.2, d.z * 0.12 * k); } },
    long:   { label: 'Long',   dir: [0.3, 0.95, 0.0], tilt: 0.2, flop: 0.5, tipY: 0.75, innerZ: 0.04, fn: (d, o) => { const k = 1 - 0.25 * Math.pow((1 - d.y) / 2, 2); return o.set(d.x * 0.15 * k, d.y * 0.5 + 0.44, d.z * 0.07); } },
    floppy: { label: 'Floppy', dir: [0.7, 0.62, 0.06], tilt: 2.55, flop: 0.45, tipY: 0.6, innerZ: 0.045, fn: (d, o) => { const k = 1 - 0.2 * Math.pow((1 + d.y) / 2, 2); return o.set(d.x * 0.19 * k, d.y * 0.36 + 0.3, d.z * 0.075); } }
  };

  // Hair styles: guide strands are rooted on rings around the head, then draped down the body.
  const HAIR = {
    bob:   { label: 'Bob',   rings: [0.998, 0.975, 0.9, 0.74, 0.58, 0.42], perRing: 18, drop: 0.78, floor: -0.5,  frontFloor: 0.5 },
    long:  { label: 'Long',  rings: [0.998, 0.975, 0.9, 0.74, 0.58, 0.42], perRing: 18, drop: 1.4,  floor: -0.66, frontFloor: 0.5 },
    pixie: { label: 'Pixie', rings: [0.998, 0.975, 0.92, 0.82, 0.7], perRing: 16, drop: 0.36, floor: 0.1,   frontFloor: 0.56 }
  };

  // Fabric presets: starting points for the fur sliders
  const FABRICS = {
    velvet: { label: 'Velvet', furLength: 0.12, furDensity: 1.3,  furThickness: 0.7,  furDroop: 0.2,  furFlex: 0.25, furVariation: 0.08, sheen: 1.0 },
    minky:  { label: 'Minky',  furLength: 0.35, furDensity: 1.0,  furThickness: 0.6,  furDroop: 0.45, furFlex: 0.5,  furVariation: 0.1,  sheen: 0.75 },
    fleece: { label: 'Fleece', furLength: 0.55, furDensity: 0.95, furThickness: 0.85, furDroop: 0.5,  furFlex: 0.6,  furVariation: 0.14, sheen: 0.45 },
    mohair: { label: 'Mohair', furLength: 0.7,  furDensity: 1.4,  furThickness: 0.75, furDroop: 0.45, furFlex: 0.72, furVariation: 0.22, sheen: 0.7 },
    shaggy: { label: 'Shaggy', furLength: 0.95, furDensity: 1.1,  furThickness: 0.8,  furDroop: 0.7,  furFlex: 0.85, furVariation: 0.18, sheen: 0.4 },
    felt:   { label: 'Felt',   furLength: 0,    furDensity: 1.7,  furThickness: 0.5,  furDroop: 0,    furFlex: 0.1,  furVariation: 0.05, sheen: 0.15 }
  };
  const FUR_KEYS = ['furLength', 'furDensity', 'furThickness', 'furDroop', 'furFlex', 'furVariation', 'sheen'];

  const OPTIONS = {
    shape: Object.keys(SHAPES).map(k => ({ id: k, label: SHAPES[k].label })),
    ears: [{ id: 'none', label: 'None' }].concat(Object.keys(EARS).map(k => ({ id: k, label: EARS[k].label }))),
    arms: [{ id: 'none', label: 'None' }, { id: 'nub', label: 'Stubby' }],
    feet: [{ id: 'none', label: 'None' }, { id: 'nub', label: 'Nubs' }, { id: 'paw', label: 'Paws' }],
    tail: [{ id: 'none', label: 'None' }, { id: 'pom', label: 'Pom' }, { id: 'curl', label: 'Curl' }, { id: 'brush', label: 'Brush' }],
    muzzle: [{ id: 'none', label: 'None' }, { id: 'snout', label: 'Snout' }],
    pattern: [{ id: 'none', label: 'Plain' }, { id: 'spots', label: 'Spots' }, { id: 'stripes', label: 'Tabby' }, { id: 'patches', label: 'Patches' }],
    fabric: Object.keys(FABRICS).map(k => ({ id: k, label: FABRICS[k].label })),
    eyes: [{ id: 'safety', label: 'Safety eyes' }, { id: 'oval', label: 'Oval' }, { id: 'stitched', label: 'Stitched' }, { id: 'happy', label: 'Happy' }, { id: 'googly', label: 'Googly' }],
    nose: [{ id: 'none', label: 'None' }, { id: 'button', label: 'Molded' }, { id: 'stitched', label: 'Stitched' }, { id: 'felt', label: 'Felt' }, { id: 'beak', label: 'Beak' }],
    mouth: [{ id: 'smile', label: 'Smile' }, { id: 'grin', label: 'Grin' }, { id: 'cat', label: 'Cat' }, { id: 'flat', label: 'Flat' }, { id: 'open', label: 'Open' }, { id: 'none', label: 'None' }],
    cheeks: [{ id: 'blush', label: 'Blush' }, { id: 'dots', label: 'Dots' }, { id: 'none', label: 'None' }],
    hat: [{ id: 'none', label: 'None' }, { id: 'beanie', label: 'Knit beanie' }, { id: 'party', label: 'Party hat' }, { id: 'crown', label: 'Crown' }, { id: 'chef', label: 'Chef hat' }, { id: 'propeller', label: 'Propeller' }, { id: 'antenna', label: 'Antenna' }, { id: 'beret', label: 'Beret' }],
    neck: [{ id: 'none', label: 'None' }, { id: 'scarf', label: 'Knit scarf' }, { id: 'bowtie', label: 'Bow tie' }, { id: 'bell', label: 'Bell collar' }],
    glasses: [{ id: 'none', label: 'None' }, { id: 'round', label: 'Round' }, { id: 'sunglasses', label: 'Sunglasses' }],
    deco: [{ id: 'none', label: 'None' }, { id: 'hairbow', label: 'Hair bow' }, { id: 'flower', label: 'Flower' }],
    hair: [{ id: 'none', label: 'None' }].concat(Object.keys(HAIR).map(k => ({ id: k, label: HAIR[k].label })))
  };

  const SWATCHES = {
    fur: ['#F5EFE6', '#E8D3B9', '#C8A27A', '#9A6A4B', '#5E4334', '#2E2A2B', '#8E96A8', '#F6B8C8', '#FF8A6B', '#E46F3B', '#F2C14E', '#8FD3B6', '#7FA7E8', '#B39DDB'],
    eye: ['#101016', '#3A2614', '#4A7A3A', '#2E5E8E', '#7A4A1E', '#5B3C88'],
    nose: ['#2A1716', '#5E3B2E', '#E5687F', '#F08AA0', '#F2A33A', '#101016'],
    cheek: ['#F7A1B5', '#F28C8C', '#FFB38A', '#E57AA0', '#C9A0DC'],
    hair: ['#1F1A1A', '#3B2A22', '#5E4334', '#8A5A3C', '#B07A4A', '#D9B26F', '#EBD9A7', '#B5453A', '#E8E8EC', '#7B5CFF', '#2F6F5E', '#FF7EB6'],
    outfit: ['#D9483B', '#2F6F5E', '#2F4A8A', '#F2C14E', '#7B5CFF', '#FF7EB6', '#FAFAF7', '#2B2F38']
  };

  const DEFAULTS = {
    name: 'Plush', seed: 7,
    shape: 'round', ears: 'none', arms: 'none', feet: 'none', tail: 'none', muzzle: 'none',
    color: '#FF8A6B', accent: '#FFE3D6', feetColor: null, pattern: 'none', patternColor: '#5E4334', patternScale: 1, tummy: false, tailTip: false,
    fabric: 'minky', furLength: 0.35, furDensity: 1.0, furThickness: 0.6, furDroop: 0.45, furFlex: 0.5, furVariation: 0.1, sheen: 0.75, furTip: null,
    eyes: 'safety', eyeSize: 1, eyeSpacing: 0.3, eyeHeight: 0.14, eyeColor: '#101016',
    nose: 'none', noseSize: 1, noseColor: '#2A1716',
    mouth: 'smile', mouthSize: 1, mouthHeight: -0.12, mouthColor: null,
    cheeks: 'blush', cheekSize: 1, cheekSpacing: 0.56, cheekColor: '#F7A1B5',
    hat: 'none', hatColor: null, neck: 'none', neckColor: null, glasses: 'none', glassesColor: '#3B2C24', deco: 'none', decoColor: null,
    hair: 'none', hairColor: '#5E4334', hairLength: 1, hairVolume: 0.5, hairFlex: 0.55, hairSilk: 0.6
  };

  const OUTFIT_COLORS = { beanie: '#D9483B', party: '#7B5CFF', crown: '#E2B33C', chef: '#FAFAF7', propeller: '#FFD23F', antenna: '#FFD54A', beret: '#1E1E24',
    scarf: '#2F6F5E', bowtie: '#C8283D', bell: '#C8283D', hairbow: '#FF7EB6', flower: '#FFFFFF' };

  function fab(id, extra) { const f = FABRICS[id], o = { fabric: id }; FUR_KEYS.forEach(k => { o[k] = f[k]; }); return Object.assign(o, extra); }
  const DOT = { arms: 'none', feet: 'none', ears: 'none', tail: 'none', muzzle: 'none', nose: 'none', mouth: 'none', cheeks: 'none', tummy: false, eyeSize: 1.15 };
  const P = (fabric, o) => fab(fabric, Object.assign({}, DOT, o));
  const PRESETS = [
    P('velvet', { id: 'mallow', name: 'Mallow', shape: 'mochi', color: '#FF7A59', accent: '#FF7A59', eyes: 'happy', cheeks: 'blush', cheekColor: '#FFC2A8', hat: 'chef', hatColor: '#FAFAF7', seed: 41 }),
    P('minky',  { id: 'plum', name: 'Plum', shape: 'gumdrop', color: '#7B4DFF', accent: '#7B4DFF', eyes: 'oval', glasses: 'sunglasses', glassesColor: '#F7F3EA', hat: 'beanie', hatColor: '#FF9F1C', seed: 42 }),
    P('velvet', { id: 'mint', name: 'Mint', shape: 'ghost', color: '#5FE0C1', accent: '#5FE0C1', eyes: 'googly', eyeSpacing: 0.26, eyeHeight: 0.18, deco: 'flower', decoColor: '#FFFFFF', seed: 43 }),
    P('velvet', { id: 'tango', name: 'Tango', shape: 'heart', color: '#FF8A1F', accent: '#FF8A1F', eyes: 'happy', eyeSpacing: 0.28, eyeHeight: 0.04, hat: 'crown', hatColor: '#FFD23F', seed: 44 }),
    P('velvet', { id: 'pebble', name: 'Pebble', shape: 'blob', color: '#FFC7D9', accent: '#FFC7D9', eyes: 'stitched', eyeColor: '#2B2F38', hatColor: '#3D7BFF', seed: 45 }),
    P('velvet', { id: 'cosmo', name: 'Cosmo', shape: 'drop', color: '#1FB5A8', accent: '#1FB5A8', eyes: 'googly', eyeSpacing: 0.24, eyeHeight: 0.0, eyeSize: 1.2, hat: 'antenna', hatColor: '#FFD54A', seed: 46 }),
    P('minky',  { id: 'poppy', name: 'Poppy', shape: 'round', color: '#FF3D4F', accent: '#FF3D4F', eyes: 'oval', cheeks: 'dots', cheekColor: '#FF9AA5', hat: 'party', hatColor: '#FFD23F', seed: 47 }),
    P('minky',  { id: 'dew', name: 'Dew', shape: 'pillow', color: '#7FD4FF', accent: '#7FD4FF', eyes: 'happy', glasses: 'round', glassesColor: '#2B2F38', neck: 'scarf', neckColor: '#FFFFFF', seed: 48 }),
    P('felt',   { id: 'truffle', name: 'Truffle', shape: 'wide', color: '#8B5A3C', accent: '#8B5A3C', eyes: 'oval', hat: 'beret', hatColor: '#F7F3EA', neck: 'bell', seed: 49 })
  ];

  const STATES = {
    idle:     { bob: 0.04,  bobSpd: 0.55, breath: 0.025, tilt: 0,     sway: 0.04, talk: 0, think: 0, hop: 0, squint: 0,   sleep: 0, wave: 0, flap: 0, wag: 0.25 },
    thinking: { bob: 0.025, bobSpd: 0.35, breath: 0.015, tilt: 0.14,  sway: 0.02, talk: 0, think: 1, hop: 0, squint: 0.1, sleep: 0, wave: 0, flap: 0, wag: 0.1 },
    talking:  { bob: 0.03,  bobSpd: 1.1,  breath: 0.02,  tilt: 0,     sway: 0.05, talk: 1, think: 0, hop: 0, squint: 0,   sleep: 0, wave: 0, flap: 0, wag: 0.35 },
    excited:  { bob: 0,     bobSpd: 0.5,  breath: 0.01,  tilt: 0,     sway: 0.08, talk: 0, think: 0, hop: 1, squint: 1,   sleep: 0, wave: 0, flap: 1, wag: 1 },
    sleepy:   { bob: 0.015, bobSpd: 0.22, breath: 0.045, tilt: -0.12, sway: 0.01, talk: 0, think: 0, hop: 0, squint: 0,   sleep: 1, wave: 0, flap: 0, wag: 0 },
    waving:   { bob: 0.03,  bobSpd: 0.6,  breath: 0.02,  tilt: 0.06,  sway: 0.05, talk: 0, think: 0, hop: 0, squint: 0.5, sleep: 0, wave: 1, flap: 0, wag: 0.6 }
  };

  const QUALITY = { high: { shells: 1, dpr: 2, hairSeg: 8 }, medium: { shells: 0.75, dpr: 1.5, hairSeg: 7 }, low: { shells: 0.5, dpr: 1, hairSeg: 5 } };

  // Parametric description of every setting, for generated editors.
  const sel = (key, label, group, extra) => Object.assign({ key, label, group, type: 'select', options: OPTIONS[key] }, extra);
  const rng = (key, label, group, min, max, step, extra) => Object.assign({ key, label, group, type: 'range', min, max, step }, extra);
  const col = (key, label, group, swatches, extra) => Object.assign({ key, label, group, type: 'color', swatches: SWATCHES[swatches] }, extra);
  const SCHEMA = [
    sel('shape', 'Silhouette', 'Body'), sel('ears', 'Ears', 'Body'), sel('arms', 'Arms', 'Body'), sel('feet', 'Feet', 'Body'),
    sel('tail', 'Tail', 'Body'), sel('muzzle', 'Muzzle', 'Body'),
    col('color', 'Fur color', 'Body', 'fur'), col('accent', 'Accent fabric', 'Body', 'fur'),
    col('feetColor', 'Feet color', 'Body', 'fur', { nullable: true, nullLabel: 'Match fur', showIf: s => s.feet !== 'none' }),
    { key: 'tummy', label: 'Tummy panel', group: 'Body', type: 'bool' },
    { key: 'tailTip', label: 'Tail tip in accent', group: 'Body', type: 'bool', showIf: s => s.tail === 'brush' || s.tail === 'curl' },
    sel('pattern', 'Markings', 'Body'), col('patternColor', 'Marking color', 'Body', 'fur', { showIf: s => s.pattern !== 'none' }),
    rng('patternScale', 'Marking scale', 'Body', 0.5, 2, 0.01, { showIf: s => s.pattern !== 'none' }),
    rng('seed', 'Handmade variation', 'Body', 1, 99, 1),
    sel('fabric', 'Fabric', 'Fur'),
    rng('furLength', 'Pile length', 'Fur', 0, 1, 0.01), rng('furDensity', 'Density', 'Fur', 0.4, 2, 0.01), rng('furThickness', 'Strand thickness', 'Fur', 0.2, 1, 0.01),
    rng('furDroop', 'Droop', 'Fur', 0, 1, 0.01), rng('furFlex', 'Floppiness', 'Fur', 0, 1, 0.01), rng('furVariation', 'Color variation', 'Fur', 0, 0.4, 0.01),
    rng('sheen', 'Sheen', 'Fur', 0, 1, 0.01), col('furTip', 'Frosted tips', 'Fur', 'fur', { nullable: true, nullLabel: 'None' }),
    sel('eyes', 'Eyes', 'Face'), col('eyeColor', 'Iris', 'Face', 'eye'), rng('eyeSize', 'Eye size', 'Face', 0.6, 1.6, 0.01),
    rng('eyeSpacing', 'Eye spacing', 'Face', 0.18, 0.45, 0.005), rng('eyeHeight', 'Eye height', 'Face', 0.02, 0.3, 0.005),
    sel('nose', 'Nose', 'Face'), col('noseColor', 'Nose color', 'Face', 'nose', { showIf: s => s.nose !== 'none' }), rng('noseSize', 'Nose size', 'Face', 0.6, 1.6, 0.01, { showIf: s => s.nose !== 'none' }),
    sel('mouth', 'Mouth', 'Face'), col('mouthColor', 'Thread', 'Face', 'nose', { nullable: true, nullLabel: 'Auto', showIf: s => s.mouth !== 'none' }),
    rng('mouthSize', 'Mouth size', 'Face', 0.6, 1.6, 0.01, { showIf: s => s.mouth !== 'none' }), rng('mouthHeight', 'Mouth height', 'Face', -0.26, -0.04, 0.005, { showIf: s => s.mouth !== 'none' }),
    sel('cheeks', 'Cheeks', 'Face'), col('cheekColor', 'Blush color', 'Face', 'cheek', { showIf: s => s.cheeks !== 'none' }), rng('cheekSize', 'Cheek size', 'Face', 0.5, 1.6, 0.01, { showIf: s => s.cheeks !== 'none' }),
    sel('hat', 'Hat', 'Outfit'), col('hatColor', 'Hat color', 'Outfit', 'outfit', { nullable: true, nullLabel: 'Default', showIf: s => s.hat !== 'none' }),
    sel('neck', 'Neckwear', 'Outfit'), col('neckColor', 'Neckwear color', 'Outfit', 'outfit', { nullable: true, nullLabel: 'Default', showIf: s => s.neck !== 'none' }),
    sel('glasses', 'Glasses', 'Outfit'), col('glassesColor', 'Frame color', 'Outfit', 'outfit', { showIf: s => s.glasses !== 'none' }),
    sel('deco', 'Decoration', 'Outfit'), col('decoColor', 'Decoration color', 'Outfit', 'outfit', { nullable: true, nullLabel: 'Default', showIf: s => s.deco !== 'none' }),
    sel('hair', 'Hair style', 'Hair'), col('hairColor', 'Hair color', 'Hair', 'hair', { showIf: s => s.hair !== 'none' }),
    rng('hairLength', 'Length', 'Hair', 0.5, 1.5, 0.01, { showIf: s => s.hair !== 'none' }), rng('hairVolume', 'Volume', 'Hair', 0, 1, 0.01, { showIf: s => s.hair !== 'none' }),
    rng('hairFlex', 'Sway', 'Hair', 0, 1, 0.01, { showIf: s => s.hair !== 'none' }), rng('hairSilk', 'Silkiness', 'Hair', 0, 1, 0.01, { showIf: s => s.hair !== 'none' })
  ];

  const STRUCT_KEYS = ['shape', 'ears', 'arms', 'feet', 'tail', 'muzzle', 'seed'];

  function normalize(cfg) {
    if (typeof cfg === 'string') { const p = PRESETS.find(x => x.id === cfg); cfg = p ? Object.assign({}, p) : {}; }
    const out = Object.assign({}, DEFAULTS, cfg || {});
    SCHEMA.forEach(f => {
      if (f.type === 'range') out[f.key] = clamp(Number(out[f.key]) || 0, f.min, f.max);
      if (f.type === 'select' && !(f.key === 'fabric' && out.fabric === 'custom') && !f.options.some(o => o.id === out[f.key])) out[f.key] = DEFAULTS[f.key] != null ? DEFAULTS[f.key] : f.options[0].id;
    });
    return out;
  }
  // Merge an edit into a config: picking a fabric fills in its fur values; touching a fur value makes the fabric custom.
  function merge(cfg, partial) {
    if (typeof partial === 'string') return normalize(partial);
    const next = Object.assign({}, cfg, partial);
    if (partial.fabric && FABRICS[partial.fabric]) FUR_KEYS.forEach(k => { if (!(k in partial)) next[k] = FABRICS[partial.fabric][k]; });
    else if (FUR_KEYS.some(k => k in partial) && !('fabric' in partial)) next.fabric = 'custom';
    return next;
  }
  function randomize(seed) {
    const r = mulberry((seed == null ? (Math.random() * 1e9) : seed) | 0), pick = a => a[Math.floor(r() * a.length)];
    const ids = k => OPTIONS[k].map(o => o.id);
    const color = pick(SWATCHES.fur), fabricId = pick(['velvet', 'minky', 'minky', 'fleece', 'mohair', 'shaggy', 'felt']);
    const lightAccent = pick(['#FFF6EC', '#F7F7F2', '#FFE3D6', '#F6C1CC', '#E8D3B9', '#DDE2EC']);
    return normalize(fab(fabricId, {
      name: pick(['Pebble', 'Toffee', 'Nimbus', 'Waffle', 'Juniper', 'Bramble', 'Pudding', 'Sprout', 'Maple', 'Tofu']),
      seed: 1 + Math.floor(r() * 98), shape: pick(ids('shape')), ears: pick(ids('ears')), arms: pick(['none', 'nub', 'nub']), feet: pick(ids('feet')),
      tail: pick(ids('tail')), muzzle: r() < 0.35 ? 'snout' : 'none', color, accent: lightAccent, tummy: r() < 0.45, tailTip: r() < 0.5,
      pattern: r() < 0.25 ? pick(['spots', 'stripes', 'patches']) : 'none', patternColor: pick(['#5E4334', '#2E2A2B', '#9A6A4B', '#F5EFE6']),
      eyes: pick(['safety', 'safety', 'safety', 'oval', 'stitched', 'happy']), eyeColor: pick(SWATCHES.eye), eyeSize: 0.85 + r() * 0.5,
      nose: pick(ids('nose').filter(x => x !== 'beak')), noseColor: pick(SWATCHES.nose), mouth: pick(['smile', 'smile', 'cat', 'grin', 'flat', 'open']),
      cheeks: pick(ids('cheeks')), cheekColor: pick(SWATCHES.cheek),
      hat: r() < 0.5 ? pick(ids('hat')) : 'none', neck: r() < 0.4 ? pick(ids('neck')) : 'none', glasses: r() < 0.15 ? 'round' : 'none',
      deco: r() < 0.2 ? pick(['hairbow', 'flower']) : 'none', hatColor: pick(SWATCHES.outfit), neckColor: pick(SWATCHES.outfit),
      hair: 'none', hairColor: pick(SWATCHES.hair), hairLength: 0.7 + r() * 0.6, hairVolume: r()
    }));
  }

  // ------------------------------------------------------------------ shaders
  const COMMON = `
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float nz(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 toLin(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 tonemap(vec3 x){ x *= 0.95; x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return pow(clamp(x, 0.0, 1.0), vec3(0.4545)); }
const vec3 LK = vec3(0.4243, 0.7071, 0.5657);
const vec3 LF = vec3(-0.8452, 0.1690, 0.5071);
const vec3 LR = vec3(0.1504, 0.5013, -0.8521);
vec3 rig(vec3 N, float w){
  float dk = clamp((dot(N, LK) + w) / (1.0 + w), 0.0, 1.0);
  float df = clamp((dot(N, LF) + w) / (1.0 + w), 0.0, 1.0);
  float dr = clamp((dot(N, LR) + w) / (1.0 + w), 0.0, 1.0);
  vec3 amb = mix(vec3(0.30, 0.27, 0.25), vec3(0.58, 0.64, 0.76), 0.5 + 0.5 * N.y);
  return vec3(1.0, 0.94, 0.86) * 1.9 * dk + vec3(0.70, 0.80, 1.0) * 0.5 * df + vec3(1.0, 0.97, 0.94) * 0.55 * dr + amb * 0.62;
}
vec3 envMap(vec3 R, float rough){
  vec3 e = mix(vec3(0.09, 0.08, 0.10), vec3(0.80, 0.86, 0.98), smoothstep(-0.35, 0.75, R.y));
  return e + vec3(0.22) * exp(-abs(R.y) * 7.0) * (1.0 - rough);
}
float softbox(vec3 R, float rough){
  float sf = 0.03 + rough * 0.3; vec2 w = vec2(R.x - 0.36, R.y - 0.48);
  float win = (1.0 - smoothstep(0.12, 0.12 + sf, abs(w.x))) * (1.0 - smoothstep(0.16, 0.16 + sf, abs(w.y))) * step(0.0, R.z);
  float bar = max(1.0 - smoothstep(0.004, 0.012, abs(w.x)), 1.0 - smoothstep(0.004, 0.012, abs(w.y)));
  return win * (1.0 - 0.8 * bar * (1.0 - smoothstep(0.0, 0.5, rough)));
}
`;

  // Fur: instanced shells, groomed, physics-driven, trimmed around the face.
  const FUR_V = `
#ifdef FUR_SHELLS
attribute float aLayer; uniform float uShellN;
#endif
attribute float aSeam;
uniform float uLayer; uniform float uLen; uniform float uDroop; uniform float uTime; uniform float uFlex; uniform float uSeamPart; uniform float uFaceW;
uniform vec3 uLin; uniform vec3 uAng; uniform vec3 uCenter; uniform vec3 uFace;
uniform vec4 uTrim[5]; uniform float uTrimN; uniform vec4 uOcc[4]; uniform float uOccN;
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec3 vT;
varying float vSeam; varying float vLayer; varying float vAO; varying float vLen; varying float vWy;
void main(){
#ifdef FUR_SHELLS
  float L = aLayer / uShellN;
#else
  float L = uLayer;
#endif
  float trim = 1.0; float ao = 1.0;
  for (int i = 0; i < 5; i++) { if (float(i) >= uTrimN) break;
    float d = distance(position, uTrim[i].xyz); float r = abs(uTrim[i].w);
    trim = min(trim, mix(0.28, 1.0, smoothstep(r, r * 1.9, d)));
    if (uTrim[i].w > 0.0) ao = min(ao, mix(0.5, 1.0, smoothstep(r * 0.92, r * 1.35, d))); }
  for (int j = 0; j < 4; j++) { if (float(j) >= uOccN) break;
    float d2 = distance(position, uOcc[j].xyz); ao = min(ao, mix(0.45, 1.0, smoothstep(uOcc[j].w * 0.75, uOcc[j].w * 1.9, d2))); }
  trim *= mix(1.0 - uSeamPart, 1.0, smoothstep(0.0, 0.05, aSeam));
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  float len = uLen * trim * length(modelMatrix[0].xyz);
  vec3 f = vec3(0.0, -0.9 * uDroop, 0.0);
  if (uFaceW > 0.0) { vec3 fc = (modelMatrix * vec4(uFace, 1.0)).xyz; vec3 fd = wp.xyz - fc; fd -= wn * dot(fd, wn); f += fd * uFaceW * 2.4 * exp(-dot(fd, fd) * 2.2); }
  f += (uLin + cross(uAng, wp.xyz - uCenter)) * uFlex;
  float br = 0.5 * sin(uTime * 1.3 + wp.y * 3.1 + wp.x * 2.3) + 0.5 * sin(uTime * 2.7 + wp.z * 4.7 - wp.y * 1.9);
  f += vec3(0.07, 0.0, 0.03) * br * (0.4 + uFlex);
  f -= wn * min(0.0, dot(f, wn)) * 0.85;
  float fl = length(f); if (fl > 1.4) f *= 1.4 / fl;
  if (L > 0.0) wp.xyz += wn * len * L + f * len * L * L;
  vT = normalize((viewMatrix * vec4(normalize(wn + f * 2.0 * max(L, 0.35)), 0.0)).xyz);
  vObj = position; vSeam = aSeam; vLayer = L; vAO = ao; vLen = len; vWy = wp.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp; vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

  const FUR_F = `
uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uTip; uniform vec3 uPatCol; uniform vec3 uSpotCol; uniform vec3 uTummyCol;
uniform float uStripes; uniform float uFreq; uniform float uTipMix; uniform float uDensity; uniform float uThick; uniform float uSheen;
uniform float uEmit; uniform float uVar; uniform float uPat; uniform float uPatScale; uniform float uFloor; uniform float uLen;
uniform vec4 uSpot[6]; uniform float uSpotN; uniform float uSpotSoft; uniform float uSpotAsp; uniform float uSpotAmt;
uniform vec4 uTummy;
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec3 vT;
varying float vSeam; varying float vLayer; varying float vAO; varying float vLen; varying float vWy;
${COMMON}
void main(){
  float L = vLayer; float rnd = 0.5; float rnd2 = 0.5; float crn = 0.5;
  if (L > 0.001) {
    vec3 g = vObj * (230.0 * uDensity / (1.0 + uLen * 28.0));
    // Tufting: strands lean toward a shared tuft centre as they rise, so the pile reads as soft clumps instead of loose needles.
    vec3 ck = floor(g / 6.0); crn = h3(ck + 41.0);
    vec3 cc = (ck + 0.5 + (vec3(h3(ck + 2.1), h3(ck + 7.7), h3(ck + 4.4)) - 0.5) * 0.5) * 6.0;
    g += (cc - g) * L * clamp(uLen * 9.0, 0.1, 0.5);
    vec3 cell = floor(g); rnd = h3(cell); rnd2 = h3(cell + 17.3);
    vec3 c0 = vec3(0.5) + (vec3(h3(cell + 3.7), h3(cell + 9.1), h3(cell + 5.3)) - 0.5) * 0.4;
    float h = mix(0.5, 1.0, rnd) * mix(0.72, 1.0, crn);
    if (h < L) discard;
    // thick, blunt strands (rounded tips) rather than tapering needles
    if (length(fract(g) - c0) > uThick * (0.45 + 0.55 * pow(1.0 - L / h, 0.45)) + 0.08) discard;
  }
  float pile = nz(vObj * 70.0 * uDensity) * 0.55 + nz(vObj * 210.0 * uDensity) * 0.45;
  vec3 col = uColor;
  if (uStripes > 0.5 && uStripes < 1.5) col = mix(uColor, uColor2, step(0.5, fract(vObj.y * uFreq)));
  else if (uStripes > 1.5 && uStripes < 2.5) { float a = atan(vObj.z, vObj.x) / 6.28318; col = uColor * (0.8 + 0.2 * (0.5 + 0.5 * cos(a * uFreq * 6.28318))); }
  else if (uStripes > 2.5) { vec2 m = vObj.xy / uFreq;
    col = uColor * (0.45 + 0.55 * (1.0 - smoothstep(-0.3, 0.7, m.y)));
    col = mix(col, uColor2, (1.0 - smoothstep(-0.5, -0.15, m.y)) * (1.0 - smoothstep(0.7, 0.95, length(m)))); }
  if (uPat > 0.5) {
    vec3 q = vObj * uPatScale; float m = 0.0;
    if (uPat < 1.5) m = smoothstep(0.6, 0.66, nz(q * 2.4 + 3.1) * 0.65 + nz(q * 5.1) * 0.35 + (pile - 0.5) * 0.06);
    else if (uPat < 2.5) { float band = sin(vObj.y * 20.0 * uPatScale + (nz(q * 2.6) - 0.5) * 5.0 + abs(vObj.x) * 3.0);
      m = smoothstep(0.25, 0.6, band) * (1.0 - smoothstep(-0.1, 0.75, normalize(vObj + vec3(0.0, 0.0, 1e-4)).z)); }
    else m = smoothstep(0.56, 0.6, nz(q * 1.25 + 7.7) * 0.8 + nz(q * 3.3) * 0.2 + (pile - 0.5) * 0.05);
    col = mix(col, uPatCol, m);
  }
  float seamT = 1.0;
  if (uTummy.w < 1.5) { vec3 q2 = normalize(vObj * vec3(0.833, 1.0, 1.0)); float ct = dot(q2, uTummy.xyz) + (pile - 0.5) * 0.004;
    col = mix(col, uTummyCol, smoothstep(uTummy.w - 0.003, uTummy.w + 0.003, ct)); seamT = abs(ct - uTummy.w); }
  col = mix(col, uTip, uTipMix * smoothstep(0.15, 1.0, L));
  float sp = 0.0;
  for (int i = 0; i < 6; i++) { if (float(i) >= uSpotN) break;
    vec3 dd = (vObj - uSpot[i].xyz) * vec3(uSpotAsp, 1.0, 1.0);
    float d = length(dd) / uSpot[i].w + (pile - 0.5) * 0.2;
    sp = max(sp, 1.0 - smoothstep(1.0 - uSpotSoft, 1.0, d)); }
  col = mix(col, mix(uSpotCol, col * uSpotCol * 1.6, 0.45), sp * uSpotAmt * (1.0 - 0.25 * L));
  col *= (1.0 + uVar * (rnd2 - 0.5) * 1.6) * (0.94 + 0.12 * crn);
  col = mix(col, col * vec3(1.07, 0.98, 0.9), (rnd - 0.5) * uVar * 2.0);
  vec3 alb = toLin(col);
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(-vView);
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  float occ = mix(1.0, mix(0.3, 1.0, pow(L, 0.75)), smoothstep(0.0, 0.05, vLen) * 0.9);
  occ *= vAO * mix(0.5, 1.0, smoothstep(uFloor, uFloor + 0.55, vWy));
  occ *= mix(0.55, 1.0, smoothstep(0.0, 0.08, vSeam)) * mix(0.62, 1.0, smoothstep(0.0, 0.012, seamT));
  occ *= 0.9 + 0.2 * pile;
  vec3 c = alb * rig(n, 0.55) * occ;
  vec3 T = normalize(vT); vec3 H = normalize(LK + V);
  float tdh = dot(T, H); float sKK = sqrt(max(0.0, 1.0 - tdh * tdh));
  float kvis = clamp(dot(n, LK) * 0.5 + 0.5, 0.0, 1.0);
  c += (vec3(1.0, 0.97, 0.92) * pow(sKK, 90.0) * 0.16 + alb * pow(sKK, 16.0) * 0.4) * uSheen * kvis * (0.25 + 0.75 * L) * occ;
  float rim = pow(1.0 - ndv, 3.0);
  c += (alb * 0.8 + vec3(0.06)) * rim * (0.3 + 0.7 * L) * uSheen * min(occ * 1.6, 1.0);
  c += alb * (0.1 * pow(L, 1.4) * uSheen) * occ;
  c += alb * uEmit;
  gl_FragColor = vec4(tonemap(c), 1.0);
}`;

  // Toy materials: 0 molded plastic, 1 resin safety eye (with eyelids), 2 metal, 3 glass
  const TOY_V = `
varying vec3 vN; varying vec3 vView; varying vec3 vP; varying vec3 vLV;
void main(){
  vP = position; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; vec3 Vv = normalize(-mv.xyz);
  vLV = vec3(dot(modelViewMatrix[0].xyz, Vv) / max(length(modelViewMatrix[0].xyz), 1e-5),
             dot(modelViewMatrix[1].xyz, Vv) / max(length(modelViewMatrix[1].xyz), 1e-5),
             dot(modelViewMatrix[2].xyz, Vv) / max(length(modelViewMatrix[2].xyz), 1e-5));
  gl_Position = projectionMatrix * mv;
}`;
  const TOY_F = `
uniform vec3 uColor; uniform vec3 uIris; uniform vec3 uLidCol;
uniform float uMode; uniform float uR; uniform float uRough; uniform float uBump; uniform float uLid; uniform float uLidLow;
varying vec3 vN; varying vec3 vView; varying vec3 vP; varying vec3 vLV;
${COMMON}
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(-vView);
  if (uBump > 0.0) { vec3 bq = vP / uR * 7.0; N = normalize(N + (vec3(nz(bq), nz(bq + 5.2), nz(bq + 9.7)) - 0.5) * uBump); }
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 env = envMap(R, uRough); float win = softbox(R, uRough);
  vec3 c; float alpha = 1.0;
  if (uMode > 2.5) {
    c = env * F * 1.3 + vec3(1.0, 0.97, 0.93) * win * 2.4;
    alpha = clamp(F * 1.4 + win * 0.85 + 0.04, 0.0, 1.0);
  } else if (uMode > 1.5) {
    vec3 tint = toLin(uColor);
    c = tint * (env * 1.1 + win * 3.2 * (1.0 - 0.6 * uRough)) + tint * 0.25 * rig(N, 0.2) * uRough + F * env * 0.25;
  } else {
    vec3 base;
    if (uMode > 0.5) {
      vec3 Vl = normalize(vLV);
      float t = max(vP.z, 0.0) / max(Vl.z, 0.35);
      vec2 q = (vP.xy - Vl.xy * t * 0.6) / uR;
      float r = length(q); float a = atan(q.y, q.x);
      vec3 iris = max(uIris, vec3(0.05)) * 1.25;
      float st = 0.65 + 0.7 * nz(vec3(a * 7.0, r * 4.0, 1.3)) * (0.55 + 0.45 * nz(vec3(a * 22.0, r * 9.0, 4.1)));
      vec3 ic = iris * st;
      ic = mix(ic, iris * 0.3, smoothstep(0.76, 0.98, r));
      ic = mix(ic, vec3(0.012, 0.012, 0.016), 1.0 - smoothstep(0.34, 0.41, r));
      float caus = smoothstep(0.32, 0.8, r) * (1.0 - smoothstep(-0.8, 0.05, q.y)) * (1.0 - smoothstep(0.88, 1.0, r));
      ic += (iris * 2.4 + vec3(0.08, 0.06, 0.045)) * caus * 0.7;
      base = toLin(ic) * rig(N, 0.3) * 0.6;
    } else {
      base = toLin(uColor) * rig(N, 0.3);
    }
    float edge = smoothstep(0.82, 1.0, length(vP.xy) / uR) * (1.0 - smoothstep(0.0, 0.4 * uR, vP.z));
    base *= 1.0 - 0.5 * edge;
    c = base + env * F * (1.0 - 0.5 * uRough) + vec3(1.0, 0.97, 0.93) * win * 2.6 * (1.0 - 0.72 * uRough);
    if (uMode > 0.5) {
      float x = clamp(vP.x / uR, -1.0, 1.0);
      float yT = (mix(1.08, -0.12, uLid) - 0.28 * (1.0 - x * x) * uLid) * uR;
      float yB = (mix(-1.08, -0.1, uLidLow) + 0.25 * (1.0 - x * x) * uLidLow) * uR;
      if (vP.y > yT || vP.y < yB) {
        vec3 la = toLin(uLidCol) * (0.85 + 0.3 * nz(vP / uR * 14.0));
        c = la * rig(N, 0.45) * 0.9;
        if (vP.y > yT) c *= mix(0.2, 1.0, smoothstep(0.0, 0.1 * uR, vP.y - yT));
        else c *= mix(0.45, 1.0, smoothstep(0.0, 0.08 * uR, yB - vP.y));
      }
    }
  }
  gl_FragColor = vec4(tonemap(c), alpha);
}`;

  // Embroidery and cloth: 0 satin stitch, 1 twisted yarn, 2 knit (uv), 3 satin ribbon
  const THREAD_V = `
uniform vec3 uDir; uniform vec3 uPerp;
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec2 vUv; varying vec3 vT; varying vec3 vB;
void main(){
  vUv = uv; vObj = position; vN = normalize(normalMatrix * normal);
  vT = normalize(normalMatrix * uDir); vB = normalize(normalMatrix * uPerp);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
  const THREAD_F = `
uniform vec3 uColor; uniform float uMode; uniform float uTwist; uniform float uStitch; uniform float uRib;
uniform vec3 uDir; uniform vec3 uPerp; uniform float uFreq;
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec2 vUv; varying vec3 vT; varying vec3 vB;
${COMMON}
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(-vView);
  float shade = 1.0; float an = 0.0; float gloss = 0.4;
  if (uMode < 0.5) {
    float s = dot(vObj, uPerp) * uFreq; float f = fract(s); float id = floor(s);
    float bul = sin(f * 3.14159);
    vec3 T = normalize(vT - N * dot(vT, N));
    N = normalize(N + normalize(vB) * (f - 0.5) * 1.6);
    float along = dot(vObj, uDir) * uFreq;
    shade = (0.5 + 0.5 * sqrt(bul)) * (0.9 + 0.2 * h3(vec3(id, 3.1, 7.7)));
    shade *= 0.88 + 0.24 * nz(vec3(along * 3.0 + s * 2.0, s * 6.0, 0.5));
    vec3 H = normalize(LK + V); float th = dot(T, H); an = pow(sqrt(max(0.0, 1.0 - th * th)), 40.0) * bul;
  } else if (uMode < 1.5) {
    float p = vUv.y * 3.0 + vUv.x * uTwist; float f = fract(p);
    float bul = sin(f * 3.14159);
    shade = 0.58 + 0.42 * sqrt(bul);
    if (uStitch > 0.5) { float st = fract(vUv.x * uStitch); shade *= 0.72 + 0.28 * smoothstep(0.0, 0.1, min(st, 1.0 - st)); }
    shade *= 0.86 + 0.28 * nz(vec3(vUv.x * uTwist * 9.0, vUv.y * 30.0, 2.0));
    an = bul * 0.35 * pow(1.0 - abs(dot(N, V)), 1.5);
  } else if (uMode < 2.5) {
    vec2 k = vec2(vUv.x * uTwist, vUv.y * uStitch);
    float fx = fract(k.x); float colId = floor(k.x);
    float h;
    if (uRib > 0.5 && mod(colId, 2.0) > 0.5) {
      float py = fract(k.y * 2.0) - 0.5; h = 0.35 * (1.0 - smoothstep(0.2, 0.5, abs(py))) * (1.0 - smoothstep(0.25, 0.5, abs(fx - 0.5)));
    } else {
      float hf = step(0.5, fx); float lx = fract(fx * 2.0) - 0.5; float slant = hf * 2.0 - 1.0;
      float ly = fract(k.y + slant * lx * 0.55) - 0.5;
      float e = length(vec2(lx * 1.15, ly * 1.25));
      h = 1.0 - smoothstep(0.32, 0.6, e);
    }
    float fuzz = nz(vec3(k * vec2(9.0, 7.0), 1.0)) * 0.5 + nz(vec3(k * vec2(31.0, 23.0), 4.0)) * 0.5;
    shade = (0.32 + 0.68 * h) * (0.85 + 0.3 * fuzz);
    an = pow(h, 5.0) * 0.12; gloss = 0.15;
  } else {
    vec3 T = normalize(vT - N * dot(vT, N));
    vec3 H = normalize(LK + V); float th = dot(T, H); float sk = sqrt(max(0.0, 1.0 - th * th));
    an = pow(sk, 14.0) * 0.55 + pow(sk, 80.0) * 0.6;
    shade = 0.9 + 0.1 * nz(vec3(dot(vObj, uDir) * 900.0, dot(vObj, uPerp) * 60.0, 0.0));
    gloss = 1.0;
  }
  vec3 alb = toLin(uColor);
  float ndv = clamp(dot(N, V), 0.0, 1.0); float rim = pow(1.0 - ndv, 2.5);
  vec3 c = alb * rig(N, 0.45) * shade;
  c += mix(alb, vec3(1.0), 0.5) * (an * gloss * 1.4 + rim * 0.12) * clamp(dot(N, LK) * 0.5 + 0.6, 0.0, 1.0);
  gl_FragColor = vec4(tonemap(c), 1.0);
}`;

  // Hair cards: procedural fibres (no textures), Scheuermann-style two-lobe Kajiya-Kay highlights.
  const HAIR_V = `
attribute vec3 aTan; attribute float aId;
varying vec3 vN; varying vec3 vT; varying vec3 vView; varying vec2 vUv; varying float vId;
void main(){
  vUv = uv; vId = aId;
  vN = normalize(normalMatrix * normal);
  vT = normalize(normalMatrix * aTan);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
  const HAIR_F = `
uniform vec3 uColor; uniform float uSheen; uniform float uSilk; uniform float uFib;
varying vec3 vN; varying vec3 vT; varying vec3 vView; varying vec2 vUv; varying float vId;
${COMMON}
void main(){
  float x = vUv.x, v = vUv.y;
  float gx = x * uFib, fi = floor(gx), fr = fract(gx) - 0.5;
  float r1 = h3(vec3(fi, vId * 13.7, 1.7)), r2 = h3(vec3(fi, vId * 5.3, 9.1));
  float endV = 0.82 + 0.18 * r1;
  float body = 1.0 - smoothstep(0.43 + 0.05 * r2, 0.5, abs(fr));
  float edge = smoothstep(0.0, 0.1, x) * (1.0 - smoothstep(0.9, 1.0, x));
  float a = body * edge * (1.0 - smoothstep(endV - 0.14, endV, v)) * smoothstep(0.0, 0.03, v);
  if (a < 0.04) discard;
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView), T = normalize(vT);
  vec3 B = normalize(cross(T, N));
  N = normalize(N + B * (fr * 0.9 + (x - 0.5) * 0.6));
  vec3 col = uColor * (0.8 + 0.4 * r1);
  col = mix(col, col * vec3(1.08, 1.0, 0.92), r2 - 0.5);
  vec3 alb = toLin(col);
  float occ = mix(0.42, 1.0, smoothstep(0.0, 0.32, v)) * (0.9 + 0.1 * r2);
  vec3 c = alb * rig(N, 0.6) * occ;
  vec3 H = normalize(LK + V);
  float shift = (nz(vec3(x * 6.0, v * 9.0, vId * 17.0)) - 0.5) * 0.16;
  vec3 T1 = normalize(T + N * (shift + 0.05)), T2 = normalize(T + N * (shift - 0.22));
  float d1 = dot(T1, H), d2 = dot(T2, H);
  float s1 = sqrt(max(0.0, 1.0 - d1 * d1)), s2 = sqrt(max(0.0, 1.0 - d2 * d2));
  float att = clamp(dot(N, LK) * 0.5 + 0.5, 0.0, 1.0) * smoothstep(-1.0, 0.0, d1);
  vec3 spec = vec3(1.0, 0.97, 0.93) * pow(s1, mix(90.0, 380.0, uSilk)) * 0.34
            + alb * 1.7 * pow(s2, mix(36.0, 130.0, uSilk)) * (0.7 + 0.5 * r1) * 0.3;
  c += spec * att * occ * uSheen;
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  c += alb * rim * 0.25 * uSheen * occ;
  gl_FragColor = vec4(tonemap(c), a);
}`;

  const SHADOW_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const SHADOW_F = `uniform float uOp; varying vec2 vUv;
void main(){ vec2 p = vUv * 2.0 - 1.0; p.y *= 1.12; float r2 = dot(p, p);
  float a = (exp(-r2 * 10.0) * 0.6 + exp(-r2 * 2.6) * 0.32) * uOp * (1.0 - smoothstep(0.55, 1.0, sqrt(r2))); gl_FragColor = vec4(0, 0, 0, a); }`;

  // ------------------------------------------------------------------ materials
  const sharedTime = { value: 0 };
  let curDyn = null;
  function makeDyn() { return { uLin: { value: new V3() }, uAng: { value: new V3() }, uCenter: { value: new V3() }, uFlex: { value: 1 }, uFloor: { value: -1 } }; }
  const idleDyn = makeDyn();
  const v4s = n => Array.from({ length: n }, () => new V4());

  function fabricU(o) {
    o = o || {}; const D = curDyn || idleDyn, color = o.color || '#ffffff';
    return {
      uColor: { value: hex(color) }, uColor2: { value: hex(o.color2 || color) }, uTip: { value: hex(color) }, uPatCol: { value: hex(color) },
      uSpotCol: { value: hex('#ffffff') }, uTummyCol: { value: hex(color) },
      uStripes: { value: o.stripes || 0 }, uFreq: { value: o.freq || 8 }, uTipMix: { value: 0 }, uDensity: { value: o.pile || 1.6 },
      uThick: { value: o.thick != null ? o.thick : 0.6 }, uDroop: { value: o.droop != null ? o.droop : 0.45 },
      uSheen: { value: o.sheen != null ? o.sheen : 0.3 }, uEmit: { value: 0 }, uVar: { value: o.vari != null ? o.vari : 0.08 },
      uPat: { value: 0 }, uPatScale: { value: 1 }, uLen: { value: o.len || 0 }, uTime: sharedTime,
      uSeamPart: { value: o.seamPart || 0 }, uFaceW: { value: 0 }, uFace: { value: new V3() },
      uLin: D.uLin, uAng: D.uAng, uCenter: D.uCenter, uFlex: D.uFlex, uFloor: D.uFloor,
      uTrim: { value: v4s(5) }, uTrimN: { value: 0 }, uOcc: { value: v4s(4) }, uOccN: { value: 0 },
      uSpot: { value: v4s(6) }, uSpotN: { value: 0 }, uSpotSoft: { value: 0.5 }, uSpotAsp: { value: 1 }, uSpotAmt: { value: 1 },
      uTummy: { value: new V4(0, 0, 1, 2) }
    };
  }
  function feltU(color, o) { return fabricU(Object.assign({ color, pile: 2.4, len: 0.005, thick: 0.45, droop: 0.1, sheen: 0.22 }, o)); }

  const MAXS = 26;
  function shellGeo(geo) {
    if (geo.userData.shellGeo) return geo.userData.shellGeo;
    const ig = new THREE.InstancedBufferGeometry();
    ig.setIndex(geo.index);
    for (const k in geo.attributes) ig.setAttribute(k, geo.attributes[k]);
    const a = new Float32Array(MAXS); for (let i = 0; i < MAXS; i++) a[i] = i + 1;
    ig.setAttribute('aLayer', new THREE.InstancedBufferAttribute(a, 1));
    ig.instanceCount = MAXS;
    geo.userData.shellGeo = ig;
    return ig;
  }
  // One base draw + one instanced draw for every shell layer.
  function fabricMesh(geo, u, shells, side) {
    if (!geo.attributes.aSeam) geo.setAttribute('aSeam', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(1), 1));
    side = side || THREE.FrontSide;
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: Object.assign({}, u, { uLayer: { value: 0 } }), vertexShader: FUR_V, fragmentShader: FUR_F, side })));
    if (shells) {
      const n = Math.min(MAXS, shells), ig = shellGeo(geo); ig.instanceCount = n;
      const m = new THREE.Mesh(ig, new THREE.ShaderMaterial({
        defines: { FUR_SHELLS: '' }, uniforms: Object.assign({}, u, { uLayer: { value: 0 }, uShellN: { value: n } }),
        vertexShader: FUR_V, fragmentShader: FUR_F, side
      }));
      m.frustumCulled = false; m.userData.shell = true; grp.add(m);
    }
    return grp;
  }
  function autoFur(grp) { grp.children.forEach(c => { if (c.userData.shell) c.userData.auto = true; }); return grp; }

  function toyMat(color, o) {
    o = o || {};
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: hex(color) }, uIris: { value: hex(o.iris || color) }, uLidCol: { value: hex(o.lid || '#888888') },
        uMode: { value: o.mode || 0 }, uR: { value: o.r || 0.05 }, uRough: { value: o.rough != null ? o.rough : 0.15 },
        uBump: { value: o.bump || 0 }, uLid: { value: 0 }, uLidLow: { value: 0 }
      },
      vertexShader: TOY_V, fragmentShader: TOY_F,
      transparent: o.mode === 3, depthWrite: o.mode !== 3, side: o.mode === 3 ? THREE.DoubleSide : THREE.FrontSide
    });
  }
  function threadMat(color, o) {
    o = o || {};
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: hex(color) }, uMode: { value: o.mode || 0 }, uTwist: { value: o.twist || 8 }, uStitch: { value: o.stitch || 0 },
        uRib: { value: o.rib ? 1 : 0 }, uDir: { value: new V3().fromArray(o.dir || [1, 0, 0]) }, uPerp: { value: new V3().fromArray(o.perp || [0, 1, 0]) },
        uFreq: { value: o.freq || 140 }
      }, vertexShader: THREAD_V, fragmentShader: THREAD_F, side: THREE.DoubleSide
    });
  }

  // ------------------------------------------------------------------ geometry
  function plushGeo(fn, sfn, ws, hs, pinch) {
    const g = new THREE.SphereGeometry(1, ws || 96, hs || 72);
    g.rotateY(-PI / 2);
    const pos = g.attributes.position, n = pos.count, seam = new Float32Array(n), d = new V3(), p = new V3();
    for (let i = 0; i < n; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      fn(d, p);
      const s = sfn ? sfn(d) : 1; seam[i] = s;
      if (pinch) p.multiplyScalar(1 - pinch * (1 + 0.45 * Math.sin(Math.atan2(d.y, d.x) * 38)) * Math.exp(-(s * s) / 0.0045));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.setAttribute('aSeam', new THREE.BufferAttribute(seam, 1));
    g.computeVertexNormals();
    return g;
  }
  function patchGeo(fn, dir, a1, off, sx, a0, keep) {
    const g = new THREE.SphereGeometry(1, 48, 12, 0, PI * 2, a0 || 0, a1 - (a0 || 0));
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
    const pos = g.attributes.position, d = new V3(), p = new V3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i); d.x *= sx || 1; d.normalize().applyQuaternion(q);
      fn(d, p); p.addScaledVector(p.clone().normalize(), off);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals(); g.computeBoundingBox();
    const c = new V3();
    if (!keep) { g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z); }
    return { geo: g, center: c };
  }
  function surfAt(fn, dir, off) {
    const d = dir.clone().normalize();
    const t1 = new V3(0, 1, 0).cross(d); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize();
    const t2 = d.clone().cross(t1).normalize(), e = 0.01;
    const p0 = fn(d, new V3());
    const p1 = fn(d.clone().addScaledVector(t1, e).normalize(), new V3());
    const p2 = fn(d.clone().addScaledVector(t2, e).normalize(), new V3());
    const n = p1.sub(p0).cross(p2.sub(p0)).normalize(); if (n.dot(p0) < 0) n.negate();
    return { p: p0.clone().addScaledVector(n, off || 0), n };
  }
  function orient(obj, n) { obj.quaternion.setFromUnitVectors(new V3(0, 0, 1), n); }
  function moldGeo(size, tri, depth) {
    const g = new THREE.SphereGeometry(1, 48, 32); g.rotateX(PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(y, x);
      const k = tri ? 1 / (0.85 - 0.15 * Math.cos(3 * (a + PI / 2))) : 1 / (0.92 - 0.08 * Math.cos(3 * (a + PI / 2)));
      pos.setXYZ(i, x * k * size, y * k * size * (tri ? 0.82 : 0.8), z * size * (z > 0 ? depth : 0.15));
    }
    g.computeVertexNormals();
    return g;
  }
  function arcPts(r, a0, a1, cx, cy) {
    const out = [], n = 24;
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function yarnLine(pts, radius, color, curv) {
    const k = curv || 1;
    const vs = pts.map(p => new V3(p[0], p[1], -(p[0] * p[0] + p[1] * p[1]) * 0.5 * k));
    const curve = new THREE.CatmullRomCurve3(vs), len = curve.getLength();
    const mat = threadMat(color, { mode: 1, twist: len / 0.011, stitch: Math.max(1, Math.round(len / 0.028)) });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, Math.round(len * 500)), radius, 8, false), mat));
    [vs[0], vs[vs.length - 1]].forEach(p => { const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat); cap.position.copy(p); g.add(cap); });
    g.userData.color = mat.uniforms.uColor;
    return g;
  }
  function tubeMesh(pts, radius, mat, closed, segs) {
    const curve = new THREE.CatmullRomCurve3(pts, !!closed);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, segs || 96, radius, 14, !!closed), mat);
  }
  function disposeTree(o) { o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); }

  function getShadowMat() {
    return new THREE.ShaderMaterial({ uniforms: { uOp: { value: 1 } }, vertexShader: SHADOW_V, fragmentShader: SHADOW_F, transparent: true, depthWrite: false });
  }

  // ------------------------------------------------------------------ outfit
  function buildHat(id, ctx) {
    const g = new THREE.Group(), tint = []; let upd = () => {};
    const c = ctx.color, top = ctx.top;
    const felt = (geo, color, o, shells) => { const u = feltU(color, o); if (color === c) tint.push(u.uColor); return fabricMesh(geo, u, shells == null ? 2 : shells); };
    const pom = (r, color) => { const u = fabricU({ color, len: 0.045, pile: 0.75, thick: 0.5, sheen: 0.55, droop: 0.3, vari: 0.12 }); if (color === c) tint.push(u.uColor); return fabricMesh(new THREE.SphereGeometry(r, 32, 24), u, 9); };
    const plastic = color => toyMat(color, { rough: 0.3, r: 0.05 });
    if (id === 'beanie') {
      const up = new V3(0, 1, 0);
      const kU = threadMat(c, { mode: 2, twist: 72, stitch: 16 }), rU = threadMat(c, { mode: 2, twist: 84, stitch: 5, rib: true });
      tint.push(kU.uniforms.uColor, rU.uniforms.uColor);
      const capP = patchGeo(ctx.fn, up, 1.05, 0.06 + ctx.lift); const capM = new THREE.Mesh(capP.geo, kU); capM.position.copy(capP.center);
      const cufP = patchGeo(ctx.fn, up, 1.15, 0.1 + ctx.lift, 1, 0.84); const cufM = new THREE.Mesh(cufP.geo, rU); cufM.position.copy(cufP.center);
      const bp = new THREE.Group(); bp.add(pom(0.13, c)); bp.position.y = top + 0.14;
      g.add(capM, cufM, bp);
      upd = (t, dt, cur, p) => { bp.position.x = Math.sin(t * 2.1) * 0.01 + p.lin.x * 0.05; bp.position.y = top + 0.14 + p.lin.y * 0.03; bp.position.z = p.lin.z * 0.04; };
    } else if (id === 'party') {
      const cone = felt(new THREE.ConeGeometry(0.24, 0.56, 48), c, { stripes: 1, freq: 6, color2: '#FFFFFF' }); cone.position.y = 0.28;
      const pp = pom(0.075, '#FFFFFF'); pp.position.y = 0.58;
      g.add(cone, pp); g.position.y = top - 0.06; g.rotation.z = -0.22;
      upd = (t, dt, cur, p) => { g.rotation.z = -0.22 + Math.sin(t * 1.6) * 0.03 + cur.hop * Math.sin(t * 11) * 0.08 - p.lin.x * 0.14; g.rotation.x = p.lin.z * 0.1; };
    } else if (id === 'crown') {
      const gold = toyMat(c, { mode: 2, rough: 0.38, bump: 0.55, r: 0.05 }); tint.push(gold.uniforms.uColor);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.31, 0.13, 48, 1, true), gold));
      g.children[0].material.side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 24), gold); sp.position.set(Math.sin(a) * 0.29, 0.14, Math.cos(a) * 0.29); g.add(sp);
        const tip = pom(0.033, '#FFFFFF'); tip.position.set(Math.sin(a) * 0.29, 0.235, Math.cos(a) * 0.29); g.add(tip);
      }
      [['#C8283D', 0], ['#1E8C7E', -0.55], ['#1E8C7E', 0.55]].forEach(gm => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), toyMat(gm[0], { rough: 0.05, r: 0.04 })); s.scale.z = 0.5;
        s.position.set(Math.sin(gm[1]) * 0.315, 0, Math.cos(gm[1]) * 0.315); s.lookAt(s.position.clone().multiplyScalar(2)); g.add(s);
      });
      g.position.y = top - 0.02; g.rotation.z = 0.14;
      upd = (t, dt, cur, p) => { g.rotation.z = 0.14 + Math.sin(t * 1.4) * 0.02 + cur.hop * Math.sin(t * 12) * 0.05 - p.lin.x * 0.1; };
    } else if (id === 'chef') {
      const cot = o => { const u = fabricU(Object.assign({ color: c, pile: 3.2, len: 0.004, thick: 0.5, sheen: 0.15, droop: 0.1 }, o)); tint.push(u.uColor); return u; };
      const band = fabricMesh(new THREE.CylinderGeometry(0.27, 0.29, 0.22, 48), cot(), 2); band.position.y = 0.09; g.add(band);
      const puffs = new THREE.Group(); puffs.position.y = 0.3; g.add(puffs);
      const cu = cot();
      const cen = fabricMesh(new THREE.SphereGeometry(0.26, 32, 24), cu, 2); cen.position.y = 0.08; puffs.add(cen);
      for (let j = 0; j < 5; j++) { const b = (j / 5) * PI * 2, pf = fabricMesh(new THREE.SphereGeometry(0.19, 28, 20), cu, 2); pf.position.set(Math.sin(b) * 0.17, 0, Math.cos(b) * 0.17); puffs.add(pf); }
      g.position.y = top - 0.1; g.rotation.z = -0.1;
      upd = (t, dt, cur, p) => { const s = 1 + Math.sin(t * 2) * 0.015 + cur.hop * Math.sin(t * 13) * 0.05 - p.lin.y * 0.06; puffs.scale.set(s, 2 - s, s); puffs.rotation.z = -p.lin.x * 0.12; puffs.rotation.x = p.lin.z * 0.12; };
    } else if (id === 'propeller') {
      const cap = felt(new THREE.SphereGeometry(0.36, 48, 16, 0, PI * 2, 0, PI / 2), c, { stripes: 2, freq: 6 }); cap.scale.set(1, 0.62, 1);
      const brim = felt(new THREE.CylinderGeometry(0.38, 0.38, 0.035, 48), '#3D7BFF'); brim.position.y = 0.01;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 12), plastic('#2B2F38')); stem.position.y = 0.28;
      const blades = new THREE.Group(); blades.position.y = 0.35;
      [['#3D7BFF', 1], ['#FF4D6D', -1]].forEach(b => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.016, 0.09), plastic(b[0])); m.position.x = b[1] * 0.16; m.rotation.x = b[1] * 0.25; blades.add(m); });
      blades.add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), plastic('#2B2F38')));
      g.add(cap, brim, stem, blades); g.scale.setScalar(1.15); g.position.y = top - 0.05; g.rotation.z = -0.12;
      let spin = 0;
      upd = (t, dt, cur, p) => { spin += dt * (3 + cur.think * 14 + cur.hop * 18 + cur.talk * 4 + cur.wave * 6) * (1 - cur.sleep); blades.rotation.y = spin; g.rotation.z = -0.12 - p.lin.x * 0.08; g.rotation.x = p.lin.z * 0.08; };
    } else if (id === 'antenna') {
      const piv = new THREE.Group(); g.add(piv);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.4, 12), plastic('#2B2F38')); st.position.y = 0.2;
      const pm = pom(0.1, c); pm.position.y = 0.45;
      piv.add(st, pm); g.position.y = top - 0.04;
      const pu = pm.children[0].material.uniforms;
      upd = (t, dt, cur, p) => {
        piv.rotation.z = Math.sin(t * 2.2) * 0.06 + cur.hop * Math.sin(t * 14) * 0.18 + cur.talk * Math.sin(t * 9) * 0.05 - p.lin.x * 0.6; piv.rotation.x = p.lin.z * 0.6;
        pu.uEmit.value = cur.think * (0.25 + 0.25 * Math.sin(t * 8));
      };
    } else if (id === 'beret') {
      const cap = felt(new THREE.SphereGeometry(0.4, 48, 20), c, { sheen: 0.3 }, 6); cap.scale.set(1, 0.34, 0.95);
      const stem = felt(new THREE.SphereGeometry(0.05, 20, 14), c, { sheen: 0.3 }, 2); stem.position.set(0.02, 0.15, 0);
      g.add(cap, stem); g.position.set(0.06, top - 0.04, 0); g.rotation.z = -0.2; g.rotation.x = 0.05;
      upd = (t, dt, cur, p) => { g.rotation.z = -0.2 + Math.sin(t * 1.5) * 0.015 + cur.hop * Math.sin(t * 11) * 0.05 - p.lin.x * 0.1; g.rotation.x = 0.05 + p.lin.z * 0.08; };
    } else return null;
    return { group: g, update: upd, tint };
  }

  // Hair: ~60 guide strands rooted in rings on the head, draped down the body and rendered as
  // tapered cards. Strands are simulated in world space with Dynamic Follow-The-Leader
  // (inextensible, damped) plus a root-to-tip loosening pull back toward the styled shape.
  function mulM(e, x, y, z, out, o) {
    out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  function buildHair(id, ctx) {
    return null;
    const c = ctx.cfg, fn = ctx.fn, q = ctx.quality, ell = ctx.ell, S = q.hairSeg, P = S + 1;
    const rr = mulberry((c.seed | 0) * 131 + 7), len = c.hairLength, vol = c.hairVolume;
    const k = Math.max(6, Math.round(H.perRing * q.shells));
    const ys = H.rings.filter(y => ctx.hat === 'none' || y < 0.8);
    const strands = [], dir = new V3();
    ys.forEach((y0, ri) => {
      const layer = ys.length - 1 - ri, rad = Math.sqrt(1 - y0 * y0), excl = y0 > 0.8 ? 0 : (y0 > 0.65 ? 0.5 : 0.8);
      const kr = y0 > 0.99 ? 3 : (y0 > 0.95 ? Math.round(k * 0.45) : k);
      for (let j = 0; j < kr; j++) {
        const th = ((j + (ri % 2) * 0.5 + (rr() - 0.5) * 0.3) / kr) * PI * 2 - PI, a = Math.abs(th);
        if (a < excl) continue;
        const fl = H.floor + (H.frontFloor - H.floor) * smooth(1.83, 0.7, a);
        const yEnd = Math.min(y0 - 0.05, Math.max(y0 - H.drop * len * (0.88 + 0.24 * rr()), fl));
        strands.push({ th, y0, yEnd, layer, id: rr(), hw: Math.max(y0 > 0.95 ? 0.11 : 0.06, PI * rad * ell.rx / kr * 1.3) });
      }
    });
    const nS = strands.length; if (!nS) return null;
    const NP = nS * P;

    // Styled (rest) shape in puppet space: follow the body surface down from each root.
    const restL = new Float32Array(NP * 3);
    strands.forEach((s, si) => {
      for (let i = 0; i < P; i++) {
        const t = i / S, y = s.y0 + (s.yEnd - s.y0) * t, r = Math.sqrt(Math.max(0, 1 - y * y));
        dir.set(Math.sin(s.th) * r, y, Math.cos(s.th) * r);
        const p = surfAt(fn, dir, 0.016 + 0.02 * s.layer + vol * 0.11 * smooth(0.05, 0.6, t)).p, o = (si * P + i) * 3;
        restL[o] = p.x; restL[o + 1] = p.y; restL[o + 2] = p.z;
      }
    });

    // Card geometry: two vertices per particle, rewritten every frame.
    const pos = new Float32Array(NP * 6), tan = new Float32Array(NP * 6), nor = new Float32Array(NP * 6);
    const uv = new Float32Array(NP * 4), ids = new Float32Array(NP * 2), idx = new Uint16Array(nS * S * 6);
    let ii = 0;
    strands.forEach((s, si) => {
      for (let i = 0; i < P; i++) {
        const v = (si * P + i) * 2;
        uv[v * 2] = 0; uv[v * 2 + 1] = i / S; uv[v * 2 + 2] = 1; uv[v * 2 + 3] = i / S;
        ids[v] = ids[v + 1] = s.id;
        if (i < S) { idx[ii++] = v; idx[ii++] = v + 1; idx[ii++] = v + 2; idx[ii++] = v + 1; idx[ii++] = v + 3; idx[ii++] = v + 2; }
      }
    });
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const tanA = new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage);
    const norA = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posA); geo.setAttribute('aTan', tanA); geo.setAttribute('normal', norA);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hex(ctx.color) }, uSheen: { value: 1 }, uSilk: { value: c.hairSilk }, uFib: { value: 7 } },
      vertexShader: HAIR_V, fragmentShader: HAIR_F, side: THREE.DoubleSide
    });
    mat.alphaToCoverage = true;
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
    const g = new THREE.Group(); g.add(mesh);

    // Simulation state (world space, no per-frame allocation).
    const restW = new Float32Array(NP * 3), X = new Float32Array(NP * 3), Vel = new Float32Array(NP * 3);
    const Pd = new Float32Array(NP * 3), Cr = new Float32Array(NP * 3), Xl = new Float32Array(NP * 3), Lw = new Float32Array(NP);
    const kt = new Float32Array(P), tw = new Float32Array(P), maxD = new Float32Array(P);
    for (let i = 0; i < P; i++) { const t = i / S; kt[i] = 1 - 0.8 * Math.pow(t, 0.7); tw[i] = Math.pow(t, 1.2); }
    const M = new THREE.Matrix4(), Mi = new THREE.Matrix4();
    const rx = ell.rx, ry = ell.ry, rz = ell.rz, cy = ell.cy;
    let inited = false, lastScale = 0;

    const update = (tm, dt) => {
      ctx.puppet.updateWorldMatrix(true, false);
      M.copy(ctx.puppet.matrixWorld); Mi.copy(M).invert();
      const e = M.elements, ei = Mi.elements, now = ctx.getCfg();
      mat.uniforms.uSilk.value = now.hairSilk;
      for (let j = 0; j < NP; j++) mulM(e, restL[j * 3], restL[j * 3 + 1], restL[j * 3 + 2], restW, j * 3);
      for (let s = 0; s < nS; s++) for (let i = 1; i < P; i++) {
        const o = (s * P + i) * 3, p = o - 3, dx = restW[o] - restW[p], dy = restW[o + 1] - restW[p + 1], dz = restW[o + 2] - restW[p + 2];
        Lw[s * P + i] = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      }
      const sc0 = ctx.root.scale.x, scaling = Math.abs(sc0 - lastScale) > 0.0005 || sc0 < 0.999;
      lastScale = sc0;
      if (!inited || scaling) { X.set(restW); Vel.fill(0); inited = true; }
      else {
        const flex = clamp(now.hairFlex, 0, 1);
        for (let i = 0; i < P; i++) maxD[i] = (0.05 + 0.34 * Math.pow(i / S, 0.8)) * (0.55 + 0.75 * flex);
        const n = Math.min(6, Math.max(1, Math.ceil(dt / 0.008))), h = dt / n;
        const kBase = 80 - 66 * flex, damp = Math.exp(-(1.6 + 2.6 * (1 - flex)) * h), sd = 0.9, wAmp = 0.28 * (0.25 + 0.75 * flex);
        for (let it = 0; it < n; it++) {
          const tt = tm + it * h;
          for (let s = 0; s < nS; s++) {
            const base = s * P, ro = base * 3, ph = strands[s].id * 6.283;
            const w = (Math.sin(tt * 0.8 + ph) * 0.6 + Math.sin(tt * 2.3 + ph * 2) * 0.4) * wAmp;
            X[ro] = restW[ro]; X[ro + 1] = restW[ro + 1]; X[ro + 2] = restW[ro + 2];
            let ax = X[ro], ay = X[ro + 1], az = X[ro + 2];
            for (let i = 1; i < P; i++) {
              const o = (base + i) * 3, kk = kBase * kt[i], wt = w * tw[i];
              const vx = Vel[o] * damp, vy = Vel[o + 1] * damp, vz = Vel[o + 2] * damp;
              const fx = wt + kk * (restW[o] - X[o]), fy = -1.6 + kk * (restW[o + 1] - X[o + 1]), fz = wt * 0.6 + kk * (restW[o + 2] - X[o + 2]);
              let px = X[o] + h * vx + h * h * fx, py = X[o + 1] + h * vy + h * h * fy, pz = X[o + 2] + h * vz + h * h * fz;
              // soft leash: a strand may swing only so far from its styled shape (keeps the cut intact when hopping)
              const lx0 = px - restW[o], ly0 = py - restW[o + 1], lz0 = pz - restW[o + 2], ld = Math.sqrt(lx0 * lx0 + ly0 * ly0 + lz0 * lz0), md = maxD[i];
              if (ld > md) { const lk = md / ld; px = restW[o] + lx0 * lk; py = restW[o + 1] + ly0 * lk; pz = restW[o + 2] + lz0 * lk; }
              const dx = px - ax, dy = py - ay, dz = pz - az, sc = Lw[base + i] / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9);
              const tx = ax + dx * sc, ty = ay + dy * sc, tz = az + dz * sc;
              Cr[o] = tx - px; Cr[o + 1] = ty - py; Cr[o + 2] = tz - pz;
              Pd[o] = tx; Pd[o + 1] = ty; Pd[o + 2] = tz; ax = tx; ay = ty; az = tz;
            }
            for (let i = 1; i < P; i++) {
              const o = (base + i) * 3;
              for (let a = 0; a < 3; a++) {
                let v = (Pd[o + a] - X[o + a]) / h;
                if (i < S) v -= sd * Cr[o + 3 + a] / h;
                Vel[o + a] = clamp(v, -8, 8); X[o + a] = Pd[o + a];
              }
              // keep strands out of the body (ellipsoid in puppet space)
              mulM(ei, X[o], X[o + 1], X[o + 2], Xl, o);
              const lx = Xl[o], ly = Xl[o + 1] - cy, lz = Xl[o + 2], f = (lx / rx) * (lx / rx) + (ly / ry) * (ly / ry) + (lz / rz) * (lz / rz);
              if (f < 1) { const sc2 = 1.003 / Math.sqrt(f + 1e-9); mulM(e, lx * sc2, ly * sc2 + cy, lz * sc2, X, o); }
            }
          }
        }
      }
      // Cards from the simulated points, in puppet space.
      for (let j = 0; j < NP; j++) mulM(ei, X[j * 3], X[j * 3 + 1], X[j * 3 + 2], Xl, j * 3);
      for (let s = 0; s < nS; s++) {
        const base = s * P, hw0 = strands[s].hw;
        for (let i = 0; i < P; i++) {
          const k0 = (base + i) * 3, a = (base + Math.max(i - 1, 0)) * 3, b = (base + Math.min(i + 1, S)) * 3;
          let tx = Xl[b] - Xl[a], ty = Xl[b + 1] - Xl[a + 1], tz = Xl[b + 2] - Xl[a + 2], l = Math.sqrt(tx * tx + ty * ty + tz * tz);
          if (l < 1e-7) { tx = 0; ty = -1; tz = 0; l = 1; }
          tx /= l; ty /= l; tz /= l;
          let nx = Xl[k0] / (rx * rx), ny = (Xl[k0 + 1] - cy) / (ry * ry), nz = Xl[k0 + 2] / (rz * rz), nl = Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9;
          nx /= nl; ny /= nl; nz /= nl;
          const dn = nx * tx + ny * ty + nz * tz; nx -= tx * dn; ny -= ty * dn; nz -= tz * dn;
          nl = Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9; nx /= nl; ny /= nl; nz /= nl;
          let sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;
          const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) + 1e-9; sx /= sl; sy /= sl; sz /= sl;
          const t = i / S, hw = hw0 * (1 - 0.6 * t * t), v = (base + i) * 6;
          pos[v] = Xl[k0] - sx * hw; pos[v + 1] = Xl[k0 + 1] - sy * hw; pos[v + 2] = Xl[k0 + 2] - sz * hw;
          pos[v + 3] = Xl[k0] + sx * hw; pos[v + 4] = Xl[k0 + 1] + sy * hw; pos[v + 5] = Xl[k0 + 2] + sz * hw;
          tan[v] = tan[v + 3] = tx; tan[v + 1] = tan[v + 4] = ty; tan[v + 2] = tan[v + 5] = tz;
          nor[v] = nor[v + 3] = nx; nor[v + 1] = nor[v + 4] = ny; nor[v + 2] = nor[v + 5] = nz;
        }
      }
      posA.needsUpdate = tanA.needsUpdate = norA.needsUpdate = true;
    };
    return { group: g, update, tint: [mat.uniforms.uColor] };
  }

  const bowFn = (d, o) => o.set(d.x * 0.26, d.y * 0.13 * (0.35 + 0.65 * Math.abs(d.x)), d.z * 0.07);
  function satinBow(color, scale) {
    const m = threadMat(color, { mode: 3, dir: [1, 0, 0], perp: [0, 1, 0] });
    const bow = new THREE.Group();
    bow.add(new THREE.Mesh(plushGeo(bowFn, d => Math.abs(d.z), 48, 32, 0.08), m));
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 18), m); knot.scale.set(1, 1.15, 0.85); bow.add(knot);
    bow.scale.setScalar(scale || 1);
    return { bow, tint: [m.uniforms.uColor] };
  }

  function buildNeck(id, ctx) {
    const g = new THREE.Group(); let tint = []; let upd = () => {};
    const c = ctx.color;
    if (id === 'scarf') {
      const kU = threadMat(c, { mode: 2, twist: 120, stitch: 10 }), tU = threadMat(c, { mode: 2, twist: 22, stitch: 10 });
      tint = [kU.uniforms.uColor, tU.uniforms.uColor];
      const pts = ctx.ring(0.07 + ctx.lift * 0.9, 32);
      g.add(tubeMesh(pts, 0.072, kU, true, 160));
      const start = ctx.ringAt(0.35, 0.09 + ctx.lift * 0.9);
      const tails = new THREE.Group(); tails.position.copy(start.p); g.add(tails);
      const n = start.n;
      [[0.0, 0.0], [0.07, 0.04]].forEach((o, i) => {
        const p0 = new V3(o[0], 0, 0.02 + i * 0.015);
        const pts2 = [p0, p0.clone().add(new V3(0.03, -0.12, n.z * 0.06)), p0.clone().add(new V3(0.05 + i * 0.03, -0.3, n.z * 0.08)), p0.clone().add(new V3(0.06 + i * 0.05, -0.42 + i * 0.05, n.z * 0.07))];
        tails.add(tubeMesh(pts2, 0.06, tU, false, 40));
      });
      upd = (t, dt, cur, p) => { tails.rotation.z = -p.lin.x * 0.5 + Math.sin(t * 1.7) * 0.02; tails.rotation.x = p.lin.z * 0.5 + cur.hop * Math.sin(t * 11) * 0.05; };
    } else if (id === 'bowtie') {
      const b = satinBow(c, 1); tint = b.tint;
      const s = ctx.ringAt(0, 0.035 + ctx.lift * 0.7); g.add(b.bow); g.position.copy(s.p); orient(g, s.n);
      upd = (t, dt, cur, p) => { b.bow.rotation.y = Math.sin(t * 3) * 0.04 * (cur.talk + cur.hop + 0.3) + p.lin.x * 0.15; b.bow.rotation.z = -p.lin.x * 0.12; };
    } else if (id === 'bell') {
      const rib = threadMat(c, { mode: 3, dir: [1, 0, 0], perp: [0, 1, 0] }); tint = [rib.uniforms.uColor];
      g.add(tubeMesh(ctx.ring(0.03 + ctx.lift * 0.85, 32), 0.026, rib, true, 160));
      const s = ctx.ringAt(0, 0.05 + ctx.lift * 0.85);
      const bellG = new THREE.Group(); bellG.position.copy(s.p); g.add(bellG);
      const piv = new THREE.Group(); bellG.add(piv);
      const gold = toyMat('#D9B046', { mode: 2, rough: 0.2, r: 0.07 });
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 24), gold); bell.position.set(0, -0.075, 0.035); piv.add(bell);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.02), toyMat('#140f08', { rough: 0.6 })); slit.position.set(0, -0.105, 0.098); piv.add(slit);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), toyMat('#140f08', { rough: 0.6 })); hole.position.set(0, -0.082, 0.1); piv.add(hole);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 8, 20), gold); loop.position.set(0, -0.005, 0.035); piv.add(loop);
      upd = (t, dt, cur, p) => { piv.rotation.z = -p.lin.x * 0.9 + Math.sin(t * 2.4) * 0.04; piv.rotation.x = p.lin.z * 0.9 + cur.hop * Math.sin(t * 14) * 0.25; };
    } else return null;
    return { group: g, update: upd, tint };
  }

  function buildGlasses(id, ctx) {
    if (id !== 'round' && id !== 'sunglasses') return null;
    const sun = id === 'sunglasses';
    const g = new THREE.Group(), frame = toyMat(ctx.color, { rough: 0.22, r: 0.05 }), glass = sun ? toyMat('#0A0A0E', { rough: 0.08, r: 0.05 }) : toyMat('#ffffff', { mode: 3, rough: 0.05 });
    const rims = ctx.eyes.map(e => {
      const R = e.r * (sun ? 2.0 : 1.6);
      const rim = new THREE.Group(); rim.position.copy(e.p).addScaledVector(e.n, 0.06 + ctx.lift * 0.3); orient(rim, e.n);
      rim.add(new THREE.Mesh(new THREE.TorusGeometry(R, sun ? 0.016 : 0.011, 10, 48), frame));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(R, 40), glass); rim.add(lens);
      g.add(rim);
      return { rim, R };
    });
    if (rims.length === 2) {
      const a = rims[0].rim.position, b = rims[1].rim.position;
      const l = a.x < b.x ? rims[0] : rims[1], r = a.x < b.x ? rims[1] : rims[0];
      const pa = l.rim.position.clone().add(new V3(l.R * 0.98, 0.01, 0)), pb = r.rim.position.clone().add(new V3(-r.R * 0.98, 0.01, 0));
      const mid = pa.clone().add(pb).multiplyScalar(0.5).add(new V3(0, 0.03, 0.02));
      g.add(tubeMesh([pa, mid, pb], 0.009, frame, false, 20));
      [l, r].forEach((s, i) => {
        const sd = i === 0 ? -1 : 1, start = s.rim.position.clone().add(new V3(sd * s.R, 0.01, -0.01));
        const pts = [start];
        for (let k = 1; k <= 4; k++) { const sp = surfAt(ctx.fn, new V3(sd * (0.75 + k * 0.06), ctx.eyeY + 0.02, 0.62 - k * 0.22), 0.035 + ctx.lift * 0.9); pts.push(sp.p); }
        g.add(tubeMesh(pts, 0.008, frame, false, 30));
      });
    }
    return { group: g, update: () => {}, tint: [frame.uniforms.uColor] };
  }

  function buildDeco(id, ctx) {
    const g = new THREE.Group(); let tint = [], upd = () => {};
    const c = ctx.color;
    if (id === 'hairbow') {
      const b = satinBow(c, 1.25); tint = b.tint;
      const s = surfAt(ctx.fn, new V3(0.55, 0.8, 0.25), 0.04 + ctx.lift); g.add(b.bow); g.position.copy(s.p); orient(g, s.n); b.bow.rotation.z = -0.45;
      upd = (t, dt, cur, p) => { b.bow.rotation.z = -0.45 - p.lin.x * 0.15; b.bow.rotation.y = p.lin.x * 0.12; };
    } else if (id === 'flower') {
      const fl = new THREE.Group(); const pu = feltU(c); tint = [pu.uColor];
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * PI * 2, pet = fabricMesh(new THREE.SphereGeometry(0.075, 24, 16), pu, 2);
        pet.scale.set(1, 1.35, 0.35); pet.position.set(Math.sin(pa) * 0.09, Math.cos(pa) * 0.09, 0); pet.rotation.z = -pa; fl.add(pet);
      }
      const cc = fabricMesh(new THREE.SphereGeometry(0.05, 24, 16), fabricU({ color: '#F4BE3A', len: 0.012, pile: 2.6, thick: 0.6, sheen: 0.3 }), 4); cc.scale.z = 0.6; cc.position.z = 0.02; fl.add(cc);
      const s = surfAt(ctx.fn, new V3(-0.55, 0.72, 0.4), 0.025 + ctx.lift); g.add(fl); g.position.copy(s.p); orient(g, s.n);
      upd = (t, dt, cur, p) => { fl.rotation.z = Math.sin(t * 1.2) * 0.06 - p.lin.x * 0.2; };
    } else return null;
    return { group: g, update: upd, tint };
  }

  // ------------------------------------------------------------------ character
  function furLen(c) { return Math.max(0, c.furLength) * 0.13; }
  const DECOR_KEYS = ['eyes', 'eyeSize', 'eyeSpacing', 'eyeHeight', 'nose', 'noseSize', 'mouth', 'mouthSize', 'mouthHeight', 'hat', 'neck', 'glasses', 'deco', 'furLength', 'hair', 'hairLength', 'hairVolume'];
  const PATTERN_ID = { none: 0, spots: 1, stripes: 2, patches: 3 };

  function create(config, opts) {
    opts = opts || {};
    let cfg = normalize(config);
    const quality = QUALITY[opts.quality] || QUALITY.high;
    const motion = opts.reducedMotion ? 0.35 : 1;
    const sh = SHAPES[cfg.shape] || SHAPES.round, baseFn = shapeFn(sh);
    const seed = cfg.seed | 0, lumpAmp = 0.013;
    const fn = (d, out) => { baseFn(d, out); return out.multiplyScalar(1 + lumpAmp * lumpNoise(d, seed * 1.37 + 0.5)); };
    const dyn = makeDyn(); curDyn = dyn;

    const root = new THREE.Group(), rig = new THREE.Group(), puppet = new THREE.Group();
    root.add(rig); rig.add(puppet);

    const bodyU = fabricU({ color: cfg.color, seamPart: 0.45 }), accentU = fabricU({ color: cfg.accent, seamPart: 0.3 });
    bodyU.uTummyCol = accentU.uColor;
    const limbU = Object.assign({}, bodyU, { uTrimN: { value: 0 }, uSpotN: { value: 0 }, uOccN: { value: 0 }, uTummy: { value: new V4(0, 0, 1, 2) }, uFaceW: { value: 0 }, uSeamPart: { value: 0.3 } });
    const feetU = Object.assign({}, limbU, { uColor: { value: hex(cfg.feetColor || cfg.color) } });
    const tailU = Object.assign({}, limbU, { uTummy: { value: new V4(0, 0, 1, 2) }, uTummyCol: accentU.uColor });

    puppet.add(autoFur(fabricMesh(plushGeo(fn, seamFn(sh), 96, 72, 0.028), bodyU, 16)));
    const top0 = surfAt(fn, new V3(0, 1, 0), 0).p.y, bottom = surfAt(fn, new V3(0, -1, 0), 0).p.y;
    const hairEll = { cy: (top0 + bottom) / 2, rx: Math.abs(fn(new V3(1, 0, 0), new V3()).x) * 0.93, ry: (top0 - bottom) / 2 * 0.93, rz: Math.abs(fn(new V3(0, 0, 1), new V3()).z) * 0.93 };
    dyn.uFloor.value = bottom - 0.02;

    // Muzzle: a sewn-on dome; the face features sit on it
    let muz = null, muzzleU = null;
    if (cfg.muzzle === 'snout') {
      const md = new V3(0, (cfg.eyeHeight + cfg.mouthHeight) / 2 - 0.1, 1), s = surfAt(fn, md, 0);
      const tx = new V3(0, 1, 0).cross(s.n).normalize(), ty = s.n.clone().cross(tx).normalize();
      muz = { c: s.p, n: s.n, tx, ty, a: 0.25, b: 0.19, H: 0.09 };
    }
    const _q3 = new V3();
    function muzH(p) {
      if (!muz) return 0;
      _q3.copy(p).sub(muz.c); const u = _q3.dot(muz.tx) / muz.a, v = _q3.dot(muz.ty) / muz.b, k = 1 - u * u - v * v;
      return k > 0 ? muz.H * Math.sqrt(k) : 0;
    }
    function faceAt(dir, off) {
      const s = surfAt(fn, dir, 0);
      if (muz) {
        const h = muzH(s.p);
        if (h > 0) {
          const e = 0.008, g1 = clamp((muzH(s.p.clone().addScaledVector(muz.tx, e)) - h) / e, -3, 3), g2 = clamp((muzH(s.p.clone().addScaledVector(muz.ty, e)) - h) / e, -3, 3);
          s.p.addScaledVector(s.n, h - 0.012);
          s.n = s.n.clone().addScaledVector(muz.tx, -g1).addScaledVector(muz.ty, -g2).normalize();
        }
      }
      s.p.addScaledVector(s.n, off || 0);
      return s;
    }
    if (muz) {
      const g = new THREE.SphereGeometry(1, 72, 22, 0, PI * 2, 0, 0.42);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), muz.c.clone().normalize());
      const pos = g.attributes.position, d = new V3();
      for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i); d.x *= 1.35; d.normalize().applyQuaternion(q);
        const sp = surfAt(fn, d, 0), h = muzH(sp.p);
        sp.p.addScaledVector(sp.n, h > 0 ? h - 0.012 : -0.025);
        pos.setXYZ(i, sp.p.x, sp.p.y, sp.p.z);
      }
      g.computeVertexNormals();
      muzzleU = fabricU({ color: cfg.accent, seamPart: 0 });
      muzzleU.uColor = accentU.uColor; muzzleU.uTrim = bodyU.uTrim; muzzleU.uTrimN = bodyU.uTrimN;
      puppet.add(autoFur(fabricMesh(g, muzzleU, 16)));
    }

    // Ears
    const ears = [];
    if (EARS[cfg.ears]) {
      const E = EARS[cfg.ears];
      const earGeo = plushGeo(E.fn, d => Math.abs(d.z), 40, 30, 0.04);
      const innerGeo = earGeo.clone(); innerGeo.scale(0.62, 0.72, 0.5);
      [-1, 1].forEach(side => {
        const sa = surfAt(fn, new V3(side * E.dir[0], E.dir[1], E.dir[2]), -0.05);
        const pivot = new THREE.Group(); pivot.position.copy(sa.p);
        const base = -side * E.tilt; pivot.rotation.z = base;
        pivot.userData = { base, side, flop: E.flop, tipY: E.tipY };
        pivot.add(autoFur(fabricMesh(earGeo, limbU, 16)));
        const inner = fabricMesh(innerGeo, accentU, 0); inner.position.set(0, 0.06, E.innerZ); pivot.add(inner);
        puppet.add(pivot); ears.push(pivot);
      });
    }

    // Arms
    const arms = [], occ = [];
    if (cfg.arms === 'nub') {
      const armGeo = plushGeo((d, o) => o.set(d.x * 0.15, d.y * 0.25 - 0.17, d.z * 0.14), d => Math.abs(d.z), 40, 30, 0.03);
      [-1, 1].forEach(side => {
        const sa = surfAt(fn, new V3(side * 0.9, -0.12, 0.32), -0.07);
        const pivot = new THREE.Group(); pivot.position.copy(sa.p);
        pivot.userData = { side, base: side * 0.42, baseX: -0.25 };
        pivot.rotation.set(-0.25, 0, side * 0.42);
        pivot.add(autoFur(fabricMesh(armGeo, limbU, 16)));
        puppet.add(pivot); arms.push(pivot);
        occ.push([sa.p.x, sa.p.y - 0.08, sa.p.z, 0.17]);
      });
    }
    // Feet
    if (cfg.feet !== 'none') {
      const footFn = (d, o) => o.set(d.x * 0.17, d.y * 0.11, d.z * 0.23);
      const footGeo = plushGeo(footFn, d => Math.abs(d.y + 0.1), 40, 30, 0.03);
      [-1, 1].forEach(side => {
        const s = surfAt(fn, new V3(side * 0.45, -0.85, 0.62), 0);
        const foot = new THREE.Group();
        foot.position.set(s.p.x * 0.95, bottom + 0.1, s.p.z + 0.04);
        foot.rotation.set(-0.38, side * 0.28, 0);
        foot.add(autoFur(fabricMesh(footGeo, feetU, 16)));
        if (cfg.feet === 'paw') {
          const padU = feltU('#ffffff', { seamPart: 0 }); padU.uColor = accentU.uColor;
          const main = patchGeo(footFn, new V3(0, -0.55, 0.85), 0.42, 0.006, 1.15);
          const pm = fabricMesh(main.geo, padU, 2); pm.position.copy(main.center); foot.add(pm);
          [[-0.42, 0.1], [0, 0.22], [0.42, 0.1]].forEach(b => {
            const bg = patchGeo(footFn, new V3(b[0], b[1], 0.95), 0.15, 0.006);
            const bm = fabricMesh(bg.geo, padU, 2); bm.position.copy(bg.center); foot.add(bm);
          });
        }
        puppet.add(foot);
        occ.push([foot.position.x, foot.position.y + 0.05, foot.position.z - 0.08, 0.22]);
      });
    }
    // Tail
    let tail = null;
    if (cfg.tail !== 'none') {
      const s = surfAt(fn, new V3(0, -0.45, -1), -0.05);
      tail = new THREE.Group(); tail.position.copy(s.p); orient(tail, s.n);
      const piv = new THREE.Group(); tail.add(piv); tail.userData.piv = piv; tail.userData.kind = cfg.tail;
      if (cfg.tail === 'pom') {
        const m = fabricMesh(new THREE.SphereGeometry(0.15, 32, 24), limbU, 16); autoFur(m); m.position.z = 0.08; piv.add(m);
      } else if (cfg.tail === 'curl') {
        const pts = [new V3(0, 0, -0.02), new V3(0, 0.06, 0.16), new V3(0.06, 0.3, 0.26), new V3(0.08, 0.52, 0.18), new V3(-0.02, 0.62, 0.06)];
        const curve = new THREE.CatmullRomCurve3(pts);
        const tg = new THREE.TubeGeometry(curve, 48, 0.055, 14, false);
        piv.add(autoFur(fabricMesh(tg, tailU, 16)));
        const cap = autoFur(fabricMesh(new THREE.SphereGeometry(0.055, 20, 14), tailU, 16)); cap.position.copy(pts[pts.length - 1]); piv.add(cap);
        tailU.uTummy.value.set(-0.1, 0.9, 0.2, 2);
        tail.userData.tipDir = new V3(-0.02, 0.62, 0.06).normalize();
      } else if (cfg.tail === 'brush') {
        const brushFn = (d, o) => { const z = d.z, r = 0.2 - 0.06 * z; return o.set(d.x * r, d.y * r + 0.2 * Math.pow(z + 1, 2), z * 0.42 + 0.36); };
        piv.add(autoFur(fabricMesh(plushGeo(brushFn, d => Math.abs(d.x), 48, 36, 0.02), tailU, 16)));
        tail.userData.tipDir = brushFn(new V3(0, 0, 1), new V3()).normalize();
      }
      puppet.add(tail);
    }
    bodyU.uOccN.value = occ.length; occ.forEach((o, i) => bodyU.uOcc.value[i].set(o[0], o[1], o[2], o[3]));

    // Face + outfit (rebuilt only when their geometry changes)
    let decor = null, decorKey = '', eyeMats = [], squashEyes = [], smile = null, open = null, mouthBase = 0;
    let recolor = { eye: [], nose: [], mouth: [] }, outfit = [];
    function placed(parent, obj, dir, off) { const s = faceAt(dir, off); obj.position.copy(s.p); orient(obj, s.n); parent.add(obj); return obj; }
    function feltPatch(parent, dir, angle, off, sx, color) {
      const pg = patchGeo(fn, dir, angle, off, sx), u = feltU(color);
      const m = fabricMesh(pg.geo, u, 3); m.position.copy(pg.center); parent.add(m); return u;
    }
    const noseDir = c => new V3(0, (c.eyeHeight + c.mouthHeight) / 2 + 0.01, 1);
    const neckDy = c => clamp(c.mouthHeight - 0.36 - (cfg.shape === 'mochi' ? 0.14 : 0), -0.72, -0.3);

    function buildDecor(c) {
      curDyn = dyn;
      if (decor) { puppet.remove(decor); disposeTree(decor); }
      decor = new THREE.Group(); puppet.add(decor);
      eyeMats = []; squashEyes = []; smile = null; open = null; mouthBase = 0; recolor = { eye: [], nose: [], mouth: [] }; outfit = [];
      const fl = furLen(c) * 0.28, dark = lum(c.color) < 0.3, es = c.eyeSize, eyesInfo = [];

      [-1, 1].forEach(side => {
        const dir = new V3(side * c.eyeSpacing, c.eyeHeight, 1);
        const backing = dark && c.eyes !== 'happy', bo = backing ? 0.006 : 0;
        if (backing) feltPatch(decor, dir, 0.15 * es, 0.005 + fl * 0.85, c.eyes === 'oval' ? 0.75 : 0.9, '#FAFAF7');
        const holder = new THREE.Group(), R = 0.075 * es;
        eyesInfo.push(Object.assign(faceAt(dir, 0), { r: R * (c.eyes === 'oval' ? 1.25 : c.eyes === 'googly' ? 1.55 : 1) }));
        if (c.eyes === 'stitched') {
          const ep = patchGeo(fn, dir, 0.085 * es, 0.006 + bo + fl * 0.9, 0.8);
          const sm = threadMat(c.eyeColor, { mode: 0, dir: [0, 1, 0], perp: [1, 0, 0], freq: 150 }); recolor.eye.push(sm.uniforms.uColor);
          holder.add(new THREE.Mesh(ep.geo, sm)); holder.position.copy(ep.center);
          const hl = surfAt(fn, new V3(side * c.eyeSpacing + 0.03 * es, c.eyeHeight + 0.035 * es, 1), 0.011 + bo + fl * 0.9);
          const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014 * es, 14, 10), threadMat('#FFFFFF', { mode: 1, twist: 5 }));
          knot.position.copy(hl.p).sub(ep.center); orient(knot, hl.n); knot.scale.z = 0.55; holder.add(knot);
          decor.add(holder); squashEyes.push(holder);
        } else if (c.eyes === 'happy') {
          const hy = yarnLine(arcPts(0.05 * es, 0, PI, 0, -0.02 * es), 0.011 * es, c.eyeColor); recolor.eye.push(hy.userData.color);
          holder.add(hy); placed(decor, holder, dir, 0.004 + fl * 0.6);
        } else if (c.eyes === 'googly') {
          const white = new THREE.Mesh(new THREE.SphereGeometry(R * 1.55, 40, 28), toyMat('#FFFFFF', { rough: 0.06, r: R }));
          white.scale.z = 0.7;
          const pm = toyMat('#050507', { rough: 0.05, r: R }); recolor.eye.push(pm.uniforms.uColor);
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(R * 0.82, 32, 24), pm); pupil.position.set(0.012 * es, -0.006 * es, R * 0.95); pupil.scale.z = 0.5;
          holder.add(white, pupil); placed(decor, holder, dir, 0.002 + bo + fl * 0.45); squashEyes.push(holder);
        } else {
          const em = toyMat('#050507', { mode: 1, iris: c.eyeColor, r: R, rough: 0.04, lid: c.color }); recolor.eye.push(em.uniforms.uIris); eyeMats.push(em);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), em);
          ball.scale.set(1, c.eyes === 'oval' ? 1.5 : 1.08, 0.6); holder.add(ball);
          placed(decor, holder, dir, 0.002 + bo + fl * 0.45);
        }
      });

      const ns = c.noseSize, nd = noseDir(c);
      if (c.nose === 'button') {
        const nm = toyMat(c.noseColor, { r: 0.05 * ns, rough: 0.38, bump: 0.3 }); recolor.nose.push(nm.uniforms.uColor);
        placed(decor, new THREE.Mesh(moldGeo(0.048 * ns, false, 0.7), nm), nd, 0.002 + fl * 0.5);
      } else if (c.nose === 'stitched') {
        const tm = threadMat(c.noseColor, { mode: 0, dir: [1, 0, 0], perp: [0, 1, 0], freq: 140 }); recolor.nose.push(tm.uniforms.uColor);
        placed(decor, new THREE.Mesh(moldGeo(0.045 * ns, true, 0.35), tm), nd, 0.002 + fl * 0.75);
      } else if (c.nose === 'felt') {
        const u = feltU(c.noseColor); recolor.nose.push(u.uColor);
        placed(decor, fabricMesh(moldGeo(0.05 * ns, false, 0.22), u, 3), nd, 0.003 + fl * 0.8);
      } else if (c.nose === 'beak') {
        const u = feltU(c.noseColor, { sheen: 0.3 }); recolor.nose.push(u.uColor);
        const bg = new THREE.ConeGeometry(0.07 * ns, 0.12 * ns, 32); bg.rotateX(PI / 2); bg.translate(0, 0, 0.05 * ns); bg.scale(1.15, 0.72, 1);
        placed(decor, fabricMesh(bg, u, 3), new V3(0, nd.y - 0.04, 1), 0.0 + fl * 0.6);
      }

      if (c.mouth !== 'none') {
        const msz = c.mouthSize, mouth = new THREE.Group();
        placed(decor, mouth, new V3(0, c.mouthHeight, 1), 0.003 + fl * 0.7);
        const onMuzzle = muz && muzH(surfAt(fn, new V3(0, c.mouthHeight, 1), 0).p) > 0.01;
        const curv = onMuzzle ? 3.5 : 1;
        const mc = c.mouthColor || (dark ? '#F2F2F5' : '#2A1716'), tr = 0.0095 * msz;
        smile = new THREE.Group(); mouth.add(smile);
        const add = (pts, r) => { const y = yarnLine(pts, r || tr, mc, curv); recolor.mouth.push(y.userData.color); smile.add(y); };
        if (c.mouth === 'smile') add(arcPts(0.055 * msz, -PI, 0, 0, 0));
        else if (c.mouth === 'grin') add(arcPts(0.085 * msz, -0.9 * PI, -0.1 * PI, 0, 0), tr * 1.08);
        else if (c.mouth === 'cat') [-1, 1].forEach(s => add(arcPts(0.032 * msz, -PI, 0, s * 0.032 * msz, 0), tr * 0.9));
        else if (c.mouth === 'flat') add([[-0.0375 * msz, 0], [0, 0], [0.0375 * msz, 0]]);
        else if (c.mouth === 'open') mouthBase = 0.55;
        open = fabricMesh(new THREE.CylinderGeometry(0.06 * msz, 0.06 * msz, 0.012, 32).rotateX(PI / 2),
          fabricU({ color: '#5A1826', stripes: 3, freq: 0.06 * msz, color2: '#E07A8A', sheen: 0.15 }), 0);
        open.position.z = 0.002; open.scale.set(1.2, 0.001, 1); mouth.add(open);
      }

      // Outfit
      const lift = furLen(c) * 0.6, ndy = neckDy(c), r0 = Math.sqrt(1 - ndy * ndy);
      const ctx = {
        fn, top: top0 + lift, lift, eyes: eyesInfo, eyeY: c.eyeHeight, cfg: c, getCfg: () => cfg, puppet, root, quality, ell: hairEll, hat: c.hat,
        ring: (off, n) => { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * PI * 2; pts.push(surfAt(fn, new V3(Math.sin(a) * r0, ndy, Math.cos(a) * r0), off).p); } return pts; },
        ringAt: (a, off) => surfAt(fn, new V3(Math.sin(a) * r0, ndy, Math.cos(a) * r0), off)
      };
      const slots = [['hair', buildHair, c.hair], ['hat', buildHat, c.hat], ['neck', buildNeck, c.neck], ['glasses', buildGlasses, c.glasses], ['deco', buildDeco, c.deco]];
      slots.forEach(([slot, build, id]) => {
        if (!id || id === 'none') return;
        ctx.color = outfitColor(c, slot);
        const o = build(id, ctx);
        if (o) { o.slot = slot; outfit.push(o); decor.add(o.group); }
      });
    }
    function outfitColor(c, slot) {
      if (slot === 'glasses') return c.glassesColor || '#3B2C24';
      return c[slot + 'Color'] || OUTFIT_COLORS[c[slot]] || '#FFFFFF';
    }

    function faceUniforms(c) {
      const es = c.eyeSize, ns = c.noseSize, ms = c.mouthSize, dark = lum(c.color) < 0.3, tr = bodyU.uTrim.value; let n = 0, p;
      [-1, 1].forEach(side => {
        p = faceAt(new V3(side * c.eyeSpacing, c.eyeHeight, 1), 0).p;
        const r = (dark && c.eyes !== 'happy' ? 0.13 : c.eyes === 'oval' ? 0.1 : c.eyes === 'googly' ? 0.12 : 0.085) * es;
        tr[n++].set(p.x, p.y, p.z, c.eyes === 'happy' ? -0.07 * es : r);
      });
      if (c.nose !== 'none') { p = faceAt(noseDir(c), 0).p; tr[n++].set(p.x, p.y, p.z, (c.nose === 'beak' ? 0.09 : 0.065) * ns); }
      if (c.mouth !== 'none') { p = faceAt(new V3(0, c.mouthHeight - 0.04 * ms, 1), 0).p; tr[n++].set(p.x, p.y, p.z, -(c.mouth === 'grin' ? 0.1 : 0.075) * ms); }
      bodyU.uTrimN.value = n;
      const sp = bodyU.uSpot.value, cs = c.cheekSize, cy = c.eyeHeight - 0.18; let k = 0;
      if (c.cheeks === 'blush') {
        [-1, 1].forEach(side => { p = surfAt(fn, new V3(side * c.cheekSpacing, cy, 0.83), 0).p; sp[k++].set(p.x, p.y, p.z, 0.11 * cs); });
        bodyU.uSpotSoft.value = 0.92; bodyU.uSpotAsp.value = 0.74; bodyU.uSpotAmt.value = 0.72;
      } else if (c.cheeks === 'dots') {
        [-1, 1].forEach(side => [[0, 0.03], [-0.06, -0.025], [0.06, -0.025]].forEach(o => {
          p = surfAt(fn, new V3(side * c.cheekSpacing + o[0] * cs, cy + o[1] * cs, 0.83), 0).p; sp[k++].set(p.x, p.y, p.z, 0.026 * cs);
        }));
        bodyU.uSpotSoft.value = 0.3; bodyU.uSpotAsp.value = 1; bodyU.uSpotAmt.value = 0.95;
      }
      bodyU.uSpotN.value = k; hex(c.cheekColor, bodyU.uSpotCol.value);
      const td = new V3(0, -0.66, 1).normalize();
      bodyU.uTummy.value.set(td.x, td.y, td.z, c.tummy ? Math.cos(0.4) : 2);
      bodyU.uFace.value.copy(faceAt(new V3(0, c.eyeHeight - 0.08, 1), 0).p); bodyU.uFaceW.value = 0.55;
      if (tail && tail.userData.tipDir) { const t = tail.userData.tipDir; tailU.uTummy.value.set(t.x, t.y, t.z, c.tailTip ? Math.cos(cfg.tail === 'curl' ? 0.25 : 0.42) : 2); }
    }

    const ph = { lin: new V3(), linV: new V3(), ang: new V3(), angV: new V3(), p0: new V3(), v0: new V3(), q0: new THREE.Quaternion(), w0: new V3(), init: false, K: 95, C: 6, sq: 0, sqV: 0 };

    function applyLook(c) {
      cfg = c; curDyn = dyn;
      const dark = lum(c.color) < 0.3, len = furLen(c);
      hex(c.color, bodyU.uColor.value); hex(c.accent, accentU.uColor.value); hex(c.feetColor || c.color, feetU.uColor.value);
      [bodyU, accentU].concat(muzzleU ? [muzzleU] : []).forEach(u => {
        u.uLen.value = len; u.uDensity.value = c.furDensity; u.uThick.value = c.furThickness * 0.62; u.uDroop.value = c.furDroop;
        u.uSheen.value = c.sheen; u.uVar.value = c.furVariation;
      });
      if (muzzleU) { muzzleU.uLen.value = len * 0.45; muzzleU.uDensity.value = c.furDensity * 1.3; muzzleU.uDroop.value = c.furDroop * 0.4; }
      accentU.uSheen.value = c.sheen * 0.8;
      hex(c.furTip || c.color, bodyU.uTip.value); bodyU.uTipMix.value = c.furTip ? 1 : 0;
      bodyU.uPat.value = PATTERN_ID[c.pattern] || 0; hex(c.patternColor, bodyU.uPatCol.value); bodyU.uPatScale.value = c.patternScale;
      limbU.uPat.value = bodyU.uPat.value;
      const flex = clamp(c.furFlex != null ? c.furFlex : 0.5, 0, 1);
      dyn.uFlex.value = (0.35 + 1.1 * flex) * motion;
      ph.K = 150 - 100 * flex; ph.C = 2 * 0.3 * Math.sqrt(ph.K);
      faceUniforms(c);
      const key = JSON.stringify(DECOR_KEYS.map(k => c[k])) + dark;
      if (key !== decorKey) { decorKey = key; buildDecor(c); }
      recolor.eye.forEach(u => hex(c.eyeColor, u.value));
      recolor.nose.forEach(u => hex(c.noseColor, u.value));
      const mc = c.mouthColor || (dark ? '#F2F2F5' : '#2A1716'); recolor.mouth.forEach(u => hex(mc, u.value));
      outfit.forEach(o => { const oc = outfitColor(c, o.slot); o.tint.forEach(u => hex(oc, u.value)); });
      eyeMats.forEach(m => hex(c.color, m.uniforms.uLidCol.value));
      const nsh = c.furLength <= 0.001 ? 0 : Math.max(4, Math.min(MAXS, Math.round((8 + 16 * c.furLength) * quality.shells)));
      root.traverse(o => {
        if (!o.userData.shell) return;
        if (o.userData.auto && nsh > 0) { o.geometry.instanceCount = nsh; o.material.uniforms.uShellN.value = nsh; }
        o.visible = o.material.uniforms.uLen.value > 0.001 && (!o.userData.auto || nsh > 0);
      });
    }
    applyLook(cfg);

    const thinkU = fabricU({ color: '#FFFFFF', sheen: 0.6 });
    const thoughts = [0, 1, 2].map(i => {
      const d = fabricMesh(new THREE.SphereGeometry(0.05 + i * 0.025, 20, 14), thinkU, 0);
      d.position.set(0.95 + i * 0.2, top0 * 0.75 + i * 0.2, 0.25); d.scale.setScalar(0.001); rig.add(d); return d;
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), getShadowMat());
    shadow.rotation.x = -PI / 2; shadow.position.y = bottom - 0.03; root.add(shadow);

    // Physics: one spring-damper for the whole coat (linear + angular lag)
    const _p = new V3(), _v = new V3(), _w = new V3(), _t = new V3(), _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _qi = new THREE.Quaternion();
    const local = { lin: new V3(), ang: new V3() };
    function stepPhysics(dt) {
      puppet.getWorldPosition(_p); rig.getWorldQuaternion(_q);
      if (!ph.init) { ph.p0.copy(_p); ph.q0.copy(_q); ph.init = true; }
      _v.copy(_p).sub(ph.p0).divideScalar(dt);
      _dq.copy(ph.q0).invert().premultiply(_q);
      if (_dq.w < 0) { _dq.x = -_dq.x; _dq.y = -_dq.y; _dq.z = -_dq.z; }
      _w.set(_dq.x, _dq.y, _dq.z).multiplyScalar(2 / dt);
      if (_v.length() > 12) _v.setLength(12);
      if (_w.length() > 30) _w.setLength(30);
      ph.linV.addScaledVector(_t.copy(_v).sub(ph.v0), -1.5 * motion);
      ph.angV.addScaledVector(_t.copy(_w).sub(ph.w0), -0.12 * motion);
      const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, K = ph.K, C = ph.C;
      for (let i = 0; i < n; i++) {
        _t.copy(_v).multiplyScalar(-0.35 * motion).sub(ph.lin).multiplyScalar(K).addScaledVector(ph.linV, -C);
        ph.linV.addScaledVector(_t, h); ph.lin.addScaledVector(ph.linV, h);
        _t.copy(_w).multiplyScalar(-0.04 * motion).sub(ph.ang).multiplyScalar(K * 0.8).addScaledVector(ph.angV, -C);
        ph.angV.addScaledVector(_t, h); ph.ang.addScaledVector(ph.angV, h);
      }
      if (ph.lin.length() > 1.2) ph.lin.setLength(1.2);
      if (ph.ang.length() > 0.9) ph.ang.setLength(0.9);
      ph.p0.copy(_p); ph.q0.copy(_q); ph.v0.copy(_v); ph.w0.copy(_w);
      dyn.uLin.value.copy(ph.lin); dyn.uAng.value.copy(ph.ang); dyn.uCenter.value.copy(_p);
      _qi.copy(_q).invert();
      local.lin.copy(ph.lin).applyQuaternion(_qi); local.ang.copy(ph.ang).applyQuaternion(_qi);
    }
    function lag(px, py, pz) {
      const la = local.ang, ll = local.lin;
      return [ll.x + (la.y * pz - la.z * py), ll.y + (la.z * px - la.x * pz), ll.z + (la.x * py - la.y * px)];
    }

    let state = 'idle', mouthOverride = null; const cur = Object.assign({}, STATES.idle); let t = Math.random() * 10;
    const look = { x: 0, y: 0 }, lookCur = { x: 0, y: 0 };
    let nextBlink = 1.5 + Math.random() * 2, blinkT = -1;

    function update(dt) {
      dt = Math.min(dt || 0.016, 0.05); t += dt; sharedTime.value = t;
      const target = STATES[state], k = Math.min(1, dt * 5);
      for (const key in target) cur[key] += (target[key] - cur[key]) * k;
      const nq = Math.max(1, Math.ceil(dt / 0.008)), hq = dt / nq;
      for (let i = 0; i < nq; i++) { ph.sqV += (-170 * ph.sq - 10 * ph.sqV) * hq; ph.sq += ph.sqV * hq; }
      ph.sq = clamp(ph.sq, -0.3, 0.3);

      const hopY = Math.abs(Math.sin(t * PI * 1.1)) * 0.4 * cur.hop;
      const hopN = cur.hop > 0.01 ? hopY / (0.4 * cur.hop) : 1;
      const y = (cur.bob * Math.sin(t * cur.bobSpd * PI * 2) + hopY) * motion;
      let s = 1 + cur.breath * Math.sin(t * (2.1 - cur.sleep * 1.1)) * motion - cur.hop * 0.15 * Math.pow(1 - hopN, 6) * motion + cur.hop * 0.05 * hopN * motion;
      s *= 1 + ph.sq;
      const sx = 1 / Math.sqrt(s);
      puppet.scale.set(sx, s, sx); puppet.position.y = bottom * (1 - s); rig.position.y = y;

      let tx = look.x + (0.6 - look.x) * cur.think, ty = look.y + (0.5 - look.y) * cur.think;
      ty = ty * (1 - cur.sleep) - 0.5 * cur.sleep; tx *= 1 - cur.sleep;
      lookCur.x += (tx - lookCur.x) * Math.min(1, dt * 4); lookCur.y += (ty - lookCur.y) * Math.min(1, dt * 4);
      rig.rotation.y = lookCur.x * 0.42;
      rig.rotation.x = -lookCur.y * 0.16 + Math.sin(t * 0.8) * 0.02 * motion;
      rig.rotation.z = cur.tilt + Math.sin(t * 1.1) * cur.sway * motion;

      stepPhysics(dt);

      nextBlink -= dt;
      if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2 + Math.random() * 3.5; }
      let blink = 0;
      if (blinkT >= 0) { blinkT += dt; blink = Math.sin(Math.min(blinkT / 0.16, 1) * PI); if (blinkT > 0.16) blinkT = -1; }
      const lid = Math.max(blink, cur.sleep * 0.9, cur.squint * 0.12), lidLow = cur.squint * 0.5;
      eyeMats.forEach(m => { m.uniforms.uLid.value = lid; m.uniforms.uLidLow.value = lidLow; });
      squashEyes.forEach(e => { e.scale.y = Math.max(0.07, 1 - lid * 0.93 - lidLow * 0.4); });

      if (open) {
        const chatter = (0.5 + 0.5 * Math.sin(t * 17)) * (0.6 + 0.4 * Math.sin(t * 5.3));
        let openAmt = Math.min(1.2, mouthBase * (1 - cur.sleep) + cur.talk * (0.25 + 0.75 * chatter) + cur.hop * 0.75);
        if (mouthOverride != null) openAmt = clamp(mouthOverride, 0, 1.2);
        open.scale.y = Math.max(0.001, openAmt * 0.9);
        smile.scale.setScalar(Math.max(0.001, 1 - Math.min(1, openAmt * 1.6)));
      }

      const fx = dyn.uFlex.value;
      ears.forEach(e => {
        const u = e.userData, sd = u.side, d = lag(e.position.x, e.position.y + u.tipY, e.position.z), kf = u.flop * fx;
        e.rotation.z = u.base + sd * motion * (Math.sin(t * 2) * 0.03 + cur.hop * Math.sin(t * PI * 2.2) * 0.22 + cur.talk * Math.sin(t * 8) * 0.04)
          - sd * 0.35 * cur.sleep - d[0] * kf + sd * d[1] * kf * 0.6;
        e.rotation.x = d[2] * kf;
      });
      arms.forEach(a => {
        const u = a.userData, sd = u.side, d = lag(a.position.x, a.position.y - 0.3, a.position.z);
        const wave = sd > 0 ? cur.wave : 0;
        a.rotation.z = u.base + sd * motion * (Math.sin(t * 1.6 + sd) * 0.04 + cur.flap * (0.3 + 0.35 * Math.sin(t * 15)) + cur.talk * 0.12 * Math.sin(t * 4 + sd))
          + sd * wave * (2.2 + 0.35 * Math.sin(t * 9)) + d[0] * 0.3 * fx - sd * cur.sleep * 0.1;
        a.rotation.x = u.baseX - d[2] * 0.3 * fx + wave * 0.15;
      });
      if (tail) {
        const piv = tail.userData.piv, d = lag(tail.position.x, tail.position.y, tail.position.z - 0.2);
        piv.rotation.y = Math.sin(t * (3 + cur.wag * 9)) * 0.32 * cur.wag * motion - d[0] * 0.4 * fx;
        piv.rotation.x = d[1] * 0.35 * fx;
      }
      thoughts.forEach((d, i) => d.scale.setScalar(Math.max(0.001, cur.think * (0.75 + 0.25 * Math.sin(t * 5 - i * 1.2)))));
      outfit.forEach(o => o.update(t, dt, cur, local));
      shadow.scale.set(1 - y * 0.6, 1 - y * 0.6, 1);
      shadow.material.uniforms.uOp.value = 1 - y * 0.9;
    }

    return {
      object: root, get config() { return cfg; }, update, applyLook,
      setState: s => { if (STATES[s]) state = s; }, getState: () => state,
      lookAt: (x, y) => { look.x = clamp(x, -1, 1); look.y = clamp(y, -1, 1); },
      setMouth: v => { mouthOverride = v == null ? null : Number(v); },
      poke: () => { ph.linV.x += (Math.random() - 0.5) * 3; ph.linV.y += 2.5 + Math.random(); ph.linV.z += 1.5; ph.angV.y += (Math.random() - 0.5) * 2; ph.sqV -= 2.2 * motion; },
      shake: () => { ph.angV.y += 6 * motion; ph.linV.x += 2 * motion; },
      dispose: () => disposeTree(root)
    };
  }

  // ------------------------------------------------------------------ widget
  function mount(el, config, opts) {
    if (!el) throw new Error('Things.mount: element is required');
    opts = Object.assign({ state: 'idle', quality: 'high', interactive: true, autoLook: true, distance: 7.4 }, opts || {});
    const quality = QUALITY[opts.quality] || QUALITY.high;
    const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatio || quality.dpr));
    renderer.setClearColor(0x000000, 0);
    const cv = renderer.domElement;
    cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none;' + (opts.interactive ? 'cursor:grab' : '');
    el.appendChild(cv);

    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    let cfg = normalize(config), bot = null, leaving = [], entering = null, stateName = opts.state, built = null, dirty = false, mouth = null;
    let spin = 0, spinVel = 0, dragging = false, lastX = 0, downX = 0, downY = 0, downT = 0, travel = 0, lastPointer = 0, destroyed = false;
    const listeners = {};
    const emit = (e, d) => (listeners[e] || []).forEach(f => f(d));

    function needsRebuild(a, b) {
      if (!a) return true;
      if (STRUCT_KEYS.some(k => a[k] !== b[k])) return true;
      return b.muzzle !== 'none' && (a.eyeHeight !== b.eyeHeight || a.mouthHeight !== b.mouthHeight);
    }
    function build() {
      if (bot) leaving.push({ bot, t: 0 });
      bot = create(cfg, { reducedMotion: reduced, quality: opts.quality });
      bot.setState(stateName); bot.setMouth(mouth);
      bot.object.scale.setScalar(0.001);
      scene.add(bot.object);
      entering = { t: reduced ? 1 : 0 };
      built = Object.assign({}, cfg); dirty = false;
    }
    function setConfig(partial) {
      cfg = normalize(merge(cfg, partial || {}));
      if (needsRebuild(built, cfg)) build(); else dirty = true;
      emit('change', getConfig());
    }
    function getConfig() { return Object.assign({}, cfg); }

    function resize() {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.set(0, 0.5, opts.distance * Math.max(1, 0.95 / camera.aspect));
      camera.lookAt(0, 0.12, 0);
      camera.updateProjectionMatrix();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', resize);
    resize();

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    function onMove(e) {
      if (!bot) return;
      lastPointer = now();
      if (opts.autoLook) {
        const r = el.getBoundingClientRect();
        bot.lookAt((e.clientX - (r.left + r.width / 2)) / (r.width * 0.8), -(e.clientY - (r.top + r.height / 2)) / (r.height * 0.8));
      }
      if (dragging) { const dx = e.clientX - lastX; lastX = e.clientX; spinVel = dx * 0.01; spin += spinVel; travel = Math.max(travel, Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY)); }
    }
    function onDown(e) { if (!opts.interactive) return; dragging = true; lastX = downX = e.clientX; downY = e.clientY; downT = now(); travel = 0; cv.style.cursor = 'grabbing'; }
    function onUp() {
      if (dragging && travel < 7 && now() - downT < 400 && bot) { bot.poke(); emit('poke'); }
      dragging = false; if (opts.interactive) cv.style.cursor = 'grab';
    }
    window.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    const clock = new THREE.Clock(); let raf = 0;
    const elastic = x => (x >= 1 ? 1 : 1 - Math.pow(2, -9 * x) * Math.cos(x * 10.5));
    // Audio-driven mouth: pass an <audio>/<video> element or a MediaStream
    let lip = null;
    function lipSync(source, o) {
      stopLip();
      o = Object.assign({ gain: 4, smoothing: 0.5 }, o || {});
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return () => {};
      const ctx = new AC(), an = ctx.createAnalyser(); an.fftSize = 512;
      const src = (typeof MediaStream !== 'undefined' && source instanceof MediaStream) ? ctx.createMediaStreamSource(source) : ctx.createMediaElementSource(source);
      src.connect(an); if (!(typeof MediaStream !== 'undefined' && source instanceof MediaStream)) an.connect(ctx.destination);
      lip = { ctx, an, buf: new Float32Array(an.fftSize), level: 0, o };
      if (ctx.state === 'suspended') ctx.resume();
      return stopLip;
    }
    function stopLip() { if (!lip) return; try { lip.ctx.close(); } catch (e) { /* closed */ } lip = null; mouth = null; if (bot) bot.setMouth(null); }
    function frame() {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (lip && bot) {
        lip.an.getFloatTimeDomainData(lip.buf); let sum = 0; for (let i = 0; i < lip.buf.length; i++) sum += lip.buf[i] * lip.buf[i];
        const lvl = clamp(Math.sqrt(sum / lip.buf.length) * lip.o.gain, 0, 1);
        lip.level += (lvl - lip.level) * (1 - lip.o.smoothing); bot.setMouth(lip.level);
      }
      if (dirty && bot) { dirty = false; bot.applyLook(cfg); }
      if (!dragging) { spinVel *= 0.92; spin += spinVel; spin *= 0.97; }
      if (opts.autoLook && bot && now() - lastPointer > 3500) { const tt = now() / 1000; bot.lookAt(Math.sin(tt * 0.31) * 0.45, Math.sin(tt * 0.23) * 0.25); }
      leaving = leaving.filter(l => {
        l.t += dt / 0.16; l.bot.update(dt); l.bot.object.scale.setScalar(Math.max(0.001, 1 - l.t));
        if (l.t >= 1) { scene.remove(l.bot.object); l.bot.dispose(); return false; }
        return true;
      });
      if (bot) {
        if (entering) { entering.t = Math.min(1, entering.t + dt / 0.6); bot.object.scale.setScalar(Math.max(0.001, elastic(entering.t))); if (entering.t >= 1) entering = null; }
        bot.object.rotation.y = spin;
        bot.update(dt);
      }
      renderer.render(scene, camera);
    }
    build(); frame();
    emit('ready');

    return {
      setConfig, getConfig,
      setState: s => { stateName = s; if (bot) bot.setState(s); }, getState: () => stateName,
      setMouth: v => { mouth = v == null ? null : v; if (bot) bot.setMouth(mouth); },
      lookAt: (x, y) => { lastPointer = now(); if (bot) bot.lookAt(x, y); },
      poke: () => bot && bot.poke(), shake: () => bot && bot.shake(),
      lipSync, stopLipSync: stopLip,
      setAutoLook: v => { opts.autoLook = !!v; if (!v && bot) bot.lookAt(0, 0); },
      snapshot: (type) => { if (dirty && bot) { dirty = false; bot.applyLook(cfg); } renderer.render(scene, camera); return cv.toDataURL(type || 'image/png'); },
      snapshotBlob: (type) => new Promise(res => { if (dirty && bot) { dirty = false; bot.applyLook(cfg); } renderer.render(scene, camera); cv.toBlob(res, type || 'image/png'); }),
      on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); return () => { listeners[e] = listeners[e].filter(x => x !== f); }; },
      get canvas() { return cv; }, get bot() { return bot; }, resize,
      destroy: () => {
        destroyed = true; cancelAnimationFrame(raf); stopLip();
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        leaving.forEach(l => l.bot.dispose()); if (bot) bot.dispose(); renderer.dispose(); cv.remove();
      }
    };
  }

  return {
    version: '1.0.0', create, mount, normalize, merge, randomize,
    presets: PRESETS, defaults: DEFAULTS, schema: SCHEMA, options: OPTIONS, fabrics: FABRICS, swatches: SWATCHES,
    states: Object.keys(STATES), qualities: Object.keys(QUALITY), structKeys: STRUCT_KEYS
  };
}

  var kit = createThings(THREE);
  kit.createThings = createThings;
  return kit;
}));

