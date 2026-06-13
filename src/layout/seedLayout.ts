import type { EmotionEntry } from '../storage/entries';
import type { EmotionKey } from '../theme/emotions';

/**
 * 初期パイルの配置を計算する純粋関数（物理・React 非依存）。
 *
 * 方式: ドロップ・パッキング。x を画面幅に散らし、上から落として
 * 「地面 or 既存ボールの上」に“接して”載せる。これにより…
 *   - 隙間なく（接して積まれる）             … INVARIANT「隙間NG」
 *   - ランダム（y が地形なりにばらける）      … INVARIANT「整列NG」
 *   - 重ならない（必ず上に載る）             … INVARIANT「重なりNG」
 * を同時に満たす。物理 settle 不要＝最初から眠らせて置けるのでロード時に
 * カメラが動かない／層が上下しない。
 *
 * 出力は scripts/check-spec.ts で「ランダム・隙間なし・重なりなし」を自動検証している。
 */

export interface SeedPlacement {
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
}

export interface SeedLayout {
  placements: SeedPlacement[];
  topY: number;
}

export interface SeedLayoutOptions {
  width: number;
  ballSize: number;
  groundY: number;
  max?: number;
}

// 当たり/見た目の半径（径比）。物理ボディ半径と一致させること。
export const BALL_RADIUS_RATIO = 0.42;

// 決定論的な疑似乱数（id をシード, -1..1）
export function jitterSeed(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1;
}

const GOLDEN = 0.6180339887498949;

export function computeSeedLayout(entries: EmotionEntry[], opts: SeedLayoutOptions): SeedLayout {
  const { width, ballSize, groundY } = opts;
  const max = opts.max ?? 250;
  const sorted = [...entries]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-max);

  const r = ballSize * BALL_RADIUS_RATIO;
  const d = 2 * r; // 接触距離
  const minX = r + 1;
  const maxX = width - r - 1;
  const span = Math.max(1, maxX - minX);

  const placements: { emotion: EmotionKey; variation: number; x: number; y: number }[] = [];
  let topY = groundY;

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    // x を黄金比列で幅いっぱいに散らし、id 由来の微ジッターを足す
    const frac = (((i + 1) * GOLDEN + jitterSeed(e.id, 3) * 0.08) % 1 + 1) % 1;
    const x = minX + frac * span;

    // 落下して「地面 or 既存ボールの上」に接する y を求める
    let y = groundY - r; // まず地面
    for (const p of placements) {
      const dx = x - p.x;
      if (Math.abs(dx) < d) {
        const yc = p.y - Math.sqrt(d * d - dx * dx); // p の上に接する位置
        if (yc < y) y = yc;
      }
    }
    placements.push({ emotion: e.emotion, variation: e.variation, x, y });
    if (y - r < topY) topY = y - r;
  }

  return { placements, topY };
}
