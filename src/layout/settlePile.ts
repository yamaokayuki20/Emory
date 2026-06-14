import Matter from 'matter-js';

import type { EmotionEntry } from '../storage/entries';
import type { EmotionKey } from '../theme/emotions';

/**
 * 初期パイルを「実際に重力で落として詰めた結果」で求める純粋関数。
 *
 * 一時的な matter.js ワールドにボールを上からばらまき、同期的に settle
 * させて最終位置を返す。呼び出し側はこの最終位置に “最初から眠らせて” 置く。
 *  → 重力で詰まった自然な見た目（谷に転がり込む・隙間なし・重なりなし・ランダム）
 *  → 実機ではロード時に物理を回さないのでカメラが動かない／層が上下しない。
 *
 * docs/仕様書.md の INVARIANT を満たす。scripts/check-spec.ts が
 * （同じくNodeでこのsettleをまわしてDigest）自動検証する。
 */

export interface SettledPlacement {
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
}

export interface SettledPile {
  placements: SettledPlacement[];
  topY: number;
}

export interface SettleOptions {
  width: number;
  ballSize: number;
  groundY: number;
  max?: number;
  steps?: number;
}

// 物理ボディ半径（径比）。見た目の半径と一致させ、接触＝見た目も接触（隙間なし）に。
// settle 精度を上げて重なり（食い込み）も最小化する。
export const BODY_RADIUS_RATIO = 0.44;
// 見た目のボール半径（透明余白を除いた実寸）。重なり判定はこちらで行う。
export const VISIBLE_RADIUS_RATIO = 0.42;

function rng(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1; // -1..1
}

export function computeSettledPile(entries: EmotionEntry[], opts: SettleOptions): SettledPile {
  const { width, ballSize, groundY } = opts;
  const max = opts.max ?? 170; // ロード時 settle の負荷上限
  const steps = opts.steps ?? 300;
  const sorted = [...entries]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-max);

  const r = ballSize * BODY_RADIUS_RATIO;
  const WALL = 60;

  const engine = Matter.Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 16; // しっかり詰める（食い込み低減）
  engine.velocityIterations = 10;

  const ground = Matter.Bodies.rectangle(width / 2, groundY + 40, width + WALL * 2, 80, { isStatic: true });
  const left = Matter.Bodies.rectangle(-WALL / 2, groundY - 4000, WALL, 12000, { isStatic: true });
  const right = Matter.Bodies.rectangle(width + WALL / 2, groundY - 4000, WALL, 12000, { isStatic: true });
  Matter.Composite.add(engine.world, [ground, left, right]);

  const minX = r + 2;
  const maxX = width - r - 2;
  const span = Math.max(1, maxX - minX);
  const colW = 2 * r * 1.08;
  const cols = Math.max(1, Math.floor(span / colW) + 1);
  const pitchX = cols > 1 ? span / (cols - 1) : 0;
  const rowH = 2 * r * 1.12;

  const bodies: Matter.Body[] = [];
  sorted.forEach((e, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const offset = row % 2 === 0 ? 0 : pitchX / 2;
    let x = minX + offset + col * pitchX + rng(e.id, 7) * r * 1.1;
    x = Math.max(minX, Math.min(maxX, x));
    const y = groundY - r - row * rowH - r;
    const body = Matter.Bodies.circle(x, y, r, {
      restitution: 0.0,
      friction: 0.45,
      frictionStatic: 0.6,
      frictionAir: 0.02,
      density: 0.001,
      slop: 0.003,
    });
    bodies.push(body);
    Matter.Composite.add(engine.world, body);
  });

  for (let s = 0; s < steps; s++) Matter.Engine.update(engine, 16);

  const placements: SettledPlacement[] = [];
  let topY = groundY;
  bodies.forEach((b, i) => {
    placements.push({ emotion: sorted[i].emotion, variation: sorted[i].variation, x: b.position.x, y: b.position.y });
    if (b.position.y - r < topY) topY = b.position.y - r;
  });

  Matter.World.clear(engine.world, false);
  Matter.Engine.clear(engine);

  return { placements, topY };
}
