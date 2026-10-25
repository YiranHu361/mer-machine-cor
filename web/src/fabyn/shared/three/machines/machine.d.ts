import type * as THREE from "three";
import type { Kit } from "../kit.js";
/** Every machine module: metres, origin at bottom centre, +Y up, front faces +Z. q is job progress 0..1. */
export interface MachineModel {
  group: THREE.Group;
  /** opts.headX (mm, optional, A1 mini): where the nozzle sits while printing */
  update(q: number, t: number, opts?: { headX?: number }): void;
  /** optional: the moving print bed in millimetre space, its plate top (mm) and the sample print on it */
  bed?: THREE.Group;
  bedTop?: number;
  tag?: THREE.Group;
}
export interface MachineMeta { name: string; size_mm: [number, number, number] }
export type BuildMachine = (three: typeof THREE, kit: Kit) => MachineModel;
