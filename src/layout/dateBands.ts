import Matter from 'matter-js';

import type { EmotionEntry } from '../storage/entries';
import type { EmotionKey } from '../theme/emotions';
import { BODY_RADIUS_RATIO } from './settlePile';

/**
 * 日付ごとに「バンド（層）」を積んだ初期パイルを求める純粋関数。
 * 古い日を下から順に settle して重ね、各日の上面（次の日との境界）を点線用ポリラインで返す。
 *  → 日付で綺麗に層分離。境界はその日のバンドの“でこぼこした上面”に沿う（モックアップ準拠）。
 */

export interface BandedPlacement {
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
  dateKey: string;
}

export interface DateBoundary {
  dateKey: string;
  label: string; // 例: 12月12日
  points: { x: number; y: number }[]; // 上面ポリライン（境界）
  pillY: number; // 右側の日付ピルを置くy
}

export interface BandedPile {
  placements: BandedPlacement[];
  boundaries: DateBoundary[]; // 古い→新しい順（最新日には上境界なし）
  topY: number;
}

export interface BandOptions {
  width: number;
  ballSize: number;
  groundY: number;
  max?: number;
  stepsPerDay?: number;
}

function rng(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function computeDateBandedPile(entries: EmotionEntry[], opts: BandOptions): BandedPile {
  const { width, ballSize, groundY } = opts;
  const max = opts.max ?? 200;
  const stepsPerDay = opts.stepsPerDay ?? 170;
  const sorted = [...entries]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-max);

  // 日付ごとにグループ化（古い順）
  const groups: { key: string; label: string; items: EmotionEntry[] }[] = [];
  for (const e of sorted) {
    const k = dayKey(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(e);
    else groups.push({ key: k, label: dayLabel(e.createdAt), items: [e] });
  }

  const r = ballSize * BODY_RADIUS_RATIO;
  const WALL = 60;
  const engine = Matter.Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 16;
  engine.velocityIterations = 10;
  const ground = Matter.Bodies.rectangle(width / 2, groundY + 40, width + WALL * 2, 80, { isStatic: true });
  const left = Matter.Bodies.rectangle(-WALL / 2, groundY - 6000, WALL, 16000, { isStatic: true });
  const right = Matter.Bodies.rectangle(width + WALL / 2, groundY - 6000, WALL, 16000, { isStatic: true });
  Matter.Composite.add(engine.world, [ground, left, right]);

  const minX = r + 2;
  const maxX = width - r - 2;
  const span = Math.max(1, maxX - minX);
  const colW = 2 * r * 1.08;
  const cols = Math.max(1, Math.floor(span / colW) + 1);
  const pitchX = cols > 1 ? span / (cols - 1) : 0;
  const rowH = 2 * r * 1.12;

  // 上面サンプリング用バケット
  const NB = Math.max(6, Math.min(28, Math.round(width / 22)));
  const bucketW = width / NB;

  const placements: BandedPlacement[] = [];
  const boundaries: DateBoundary[] = [];
  let pileTop = groundY; // 現在の山の上端（次の日はこの上に落とす）

  groups.forEach((g, gi) => {
    const dayBodies: Matter.Body[] = [];
    g.items.forEach((e, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const offset = row % 2 === 0 ? 0 : pitchX / 2;
      let x = minX + offset + col * pitchX + rng(e.id, 7) * r * 1.1;
      x = Math.max(minX, Math.min(maxX, x));
      // 現在の山の上端より上から落とす
      const y = pileTop - r - 4 - row * rowH - rng(e.id, 11) * 3;
      const body = Matter.Bodies.circle(x, y, r, {
        restitution: 0.0,
        friction: 0.5,
        frictionStatic: 0.7,
        frictionAir: 0.02,
        density: 0.001,
        slop: 0.003,
      });
      (body as unknown as { _e: EmotionEntry })._e = e;
      dayBodies.push(body);
      Matter.Composite.add(engine.world, body);
    });
    for (let s = 0; s < stepsPerDay; s++) Matter.Engine.update(engine, 16);

    // この日のボール位置を記録＋上面サンプリング
    const bucketTop: number[] = new Array(NB).fill(NaN);
    let dayTop = pileTop;
    dayBodies.forEach((b) => {
      const e = (b as unknown as { _e: EmotionEntry })._e;
      placements.push({ emotion: e.emotion, variation: e.variation, x: b.position.x, y: b.position.y, dateKey: g.key });
      const top = b.position.y - r;
      if (top < dayTop) dayTop = top;
      const bi = Math.max(0, Math.min(NB - 1, Math.floor(b.position.x / bucketW)));
      if (isNaN(bucketTop[bi]) || top < bucketTop[bi]) bucketTop[bi] = top;
    });
    pileTop = dayTop;

    // 最新日には上境界を引かない（それより上は無い）。古い日だけ境界化。
    if (gi < groups.length - 1) {
      // バケットの上面を点へ。欠損は近傍で補間。
      for (let i = 0; i < NB; i++) {
        if (isNaN(bucketTop[i])) {
          // 左右の最も近い有効値
          let l = i - 1;
          while (l >= 0 && isNaN(bucketTop[l])) l--;
          let rr2 = i + 1;
          while (rr2 < NB && isNaN(bucketTop[rr2])) rr2++;
          const lv = l >= 0 ? bucketTop[l] : NaN;
          const rv = rr2 < NB ? bucketTop[rr2] : NaN;
          bucketTop[i] = isNaN(lv) ? rv : isNaN(rv) ? lv : (lv + rv) / 2;
        }
      }
      const points = bucketTop.map((y, i) => ({ x: (i + 0.5) * bucketW, y: y - 2 }));
      const pillY = points.length ? points[points.length - 1].y : pileTop;
      boundaries.push({ dateKey: g.key, label: g.label, points, pillY });
    }
  });

  Matter.World.clear(engine.world, false);
  Matter.Engine.clear(engine);

  return { placements, boundaries, topY: pileTop };
}
