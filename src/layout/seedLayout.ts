import type { EmotionEntry } from '../storage/entries';
import type { EmotionKey } from '../theme/emotions';

/**
 * 初期パイルの配置を計算する純粋関数（物理・React 非依存）。
 *
 * 重要な仕様（デグレ厳禁）:
 * - 絵文字層は「整列」ではなく「ランダムに積み上がっている」見た目であること。
 *   そのため各ボールに十分なジッター（横 ±0.18*径 など）を必ず与える。
 * - 古い順に底（groundY 付近）から積み、新しいものほど上に来る。
 * - 物理側でこの配置から settle させ、重なりを解消して自然なランダム密パックにする。
 *
 * この関数の出力は scripts/check-spec.ts で「ランダム性」を自動検証している。
 */

export interface SeedPlacement {
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
}

export interface SeedLayout {
  placements: SeedPlacement[];
  topY: number; // 配置した山の最上端（カメラ初期フレーミング用）
}

export interface SeedLayoutOptions {
  width: number;
  ballSize: number;
  groundY: number;
  max?: number; // 性能のための上限
}

// 決定論的な疑似乱数（id をシード, -1..1）
export function jitterSeed(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1;
}

// ランダム性の最低ライン（横ジッター量／径比）。テストでも参照する。
export const JITTER_X_RATIO = 0.18;
export const JITTER_Y_RATIO = 0.12;

export function computeSeedLayout(entries: EmotionEntry[], opts: SeedLayoutOptions): SeedLayout {
  const { width, ballSize, groundY } = opts;
  const max = opts.max ?? 250;
  const sorted = [...entries]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-max);

  const stepX = ballSize * 0.92;
  const stepY = ballSize * 0.86;
  const cols = Math.max(1, Math.floor(width / stepX));
  const pitchX = width / cols;

  const placements: SeedPlacement[] = [];
  let idx = 0;
  let row = 0;
  let topY = groundY;
  while (idx < sorted.length) {
    const even = row % 2 === 0;
    const n = even ? cols : Math.max(1, cols - 1); // オフセット行は右端の被り防止に1つ減らす
    const base = even ? pitchX / 2 : pitchX;
    for (let c = 0; c < n && idx < sorted.length; c++) {
      const e = sorted[idx++];
      const jx = jitterSeed(e.id, 7) * ballSize * JITTER_X_RATIO;
      const jy = jitterSeed(e.id, 13) * ballSize * JITTER_Y_RATIO;
      let x = base + c * pitchX + jx;
      x = Math.max(ballSize / 2 + 2, Math.min(width - ballSize / 2 - 2, x));
      const y = groundY - ballSize / 2 - row * stepY + jy;
      if (y - ballSize / 2 < topY) topY = y - ballSize / 2;
      placements.push({ emotion: e.emotion, variation: e.variation, x, y });
    }
    row++;
  }
  return { placements, topY };
}
