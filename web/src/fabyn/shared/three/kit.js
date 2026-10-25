// Shared look for every Fabrary machine model: one palette, one set of materials.
// Units are metres. Every model's origin is its bottom centre, +Y up, front faces +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  shell: '#E9E8E3',      // warm off-white matte plastic
  shellGrey: '#BEBDB8',  // mid grey plastic
  dark: '#1B1B1C',       // near-black matte plastic
  graphite: '#3A3A3C',   // dark grey trim
  metal: '#A9ABAE',      // brushed aluminium
  accent: '#FF5B1F',     // the one orange
  glass: '#0E0F10',      // screen glass
};

export function makeKit() {
  const std = (color, roughness, metalness = 0, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.45, ...extra });
  const mat = {
    shell: std(PALETTE.shell, 0.55),
    shellGrey: std(PALETTE.shellGrey, 0.5),
    dark: std(PALETTE.dark, 0.6),
    graphite: std(PALETTE.graphite, 0.45),
    metal: std(PALETTE.metal, 0.32, 0.85),
    accent: std(PALETTE.accent, 0.4),
    glass: std(PALETTE.glass, 0.12, 0.2),
    screen: std('#101214', 0.2, 0, { emissive: '#2a3b46', emissiveIntensity: 0.6 }),
    led: std('#ff6a2a', 0.3, 0, { emissive: PALETTE.accent, emissiveIntensity: 2.5 }),
    clear: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, transmission: 0.9, thickness: 0.004, transparent: true, opacity: 0.35 }),
    paper: std('#F7F6F1', 0.85),
  };
  // Rounded box with sensible segment count; w/h/d in metres, r = corner radius.
  const rbox = (w, h, d, r, material) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const mesh = (geometry, material) => { const m = new THREE.Mesh(geometry, material); m.castShadow = true; m.receiveShadow = true; return m; };
  return { THREE, mat, rbox, mesh, RoundedBoxGeometry, mergeGeometries, PALETTE };
}
