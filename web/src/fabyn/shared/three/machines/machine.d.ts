import type * as THREE from "three";
import type { Kit } from "../kit.js";
/** Every machine module: metres, origin at bottom centre, +Y up, front faces +Z. q is job progress 0..1. */
export interface MachineModel { group: THREE.Group; update(q: number, t: number): void }
export interface MachineMeta { name: string; size_mm: [number, number, number] }
export type BuildMachine = (three: typeof THREE, kit: Kit) => MachineModel;
