import type * as THREE from "three";
export const PALETTE: Record<"shell" | "shellGrey" | "dark" | "graphite" | "metal" | "accent" | "glass", string>;
export interface Kit {
  THREE: typeof THREE;
  mat: Record<"shell" | "shellGrey" | "dark" | "graphite" | "metal" | "accent" | "glass" | "screen" | "led" | "paper", THREE.MeshStandardMaterial> & { clear: THREE.MeshPhysicalMaterial };
  rbox(w: number, h: number, d: number, r: number, material: THREE.Material): THREE.Mesh;
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh;
  RoundedBoxGeometry: any;
  mergeGeometries: any;
  PALETTE: typeof PALETTE;
}
export function makeKit(): Kit;
