import Ufo from './Ufo';
import BasketHoop from './BasketHoop';

export type TargetKind = 'ufo' | 'basket';

export interface TargetConfig {
  kind: TargetKind;
  /** 操作エリア内のターゲット中心位置（0..1 の相対座標） */
  anchor: { x: number; y: number };
  hitRadius: number; // px
}

/**
 * 日替わりマイクロインタラクション。
 * 日付（年内通算日）をシードにターゲットを切り替える。
 * MVPでは UFO とバスケットゴールの2種。? ブロック等は同じ仕組みで追加可能。
 */
const ROTATION: TargetConfig[] = [
  { kind: 'ufo', anchor: { x: 0.5, y: 0.18 }, hitRadius: 34 },
  { kind: 'basket', anchor: { x: 0.78, y: 0.16 }, hitRadius: 30 },
];

export function dayOfYear(d: Date = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

export function targetForToday(d: Date = new Date()): TargetConfig {
  return ROTATION[dayOfYear(d) % ROTATION.length];
}

export const TargetComponents = { Ufo, BasketHoop };
export { Ufo, BasketHoop };
