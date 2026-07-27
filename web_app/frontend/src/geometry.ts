export type Vec3 = [number, number, number];

export const COLORS = {
  copper: 0xb87333,
  core: 0x30343a,
  shell: 0xe0a94a,
  airbox: 0x5aa0ff,
  board: 0x004400,
  component: 0x222222,
  via: 0xddaa44
};

export type Prim =
  | { kind: "tube"; path: Vec3[]; radius: number; color: number; opacity?: number }
  | { kind: "cylinder"; p0: Vec3; p1: Vec3; radius: number; color: number; opacity?: number }
  | { kind: "box"; center: Vec3; size: Vec3; color: number; opacity?: number }
  | { kind: "ring"; outer: number; inner: number; height: number; color: number; opacity?: number }
  | { kind: "airbox"; min: Vec3; max: Vec3 };

export interface Bounds { min: Vec3; max: Vec3 }

export interface Scene {
  prims: Prim[];
  bounds: Bounds;    
  fitBounds: Bounds; 
}
