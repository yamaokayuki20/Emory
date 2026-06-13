import type { EmotionEntry } from '../storage/entries';
import type { EmotionKey } from '../theme/emotions';

/**
 * 初期パイルの配置を計算する純粋関数（物理・React 非依存）。
 *
 * 重要な仕様（デグレ厳禁。docs/仕様書.md 参照）:
 * - 絵文字層は「整列」ではなく「ランダムに積み上がっている」見た目。各ボールに横ジッターを必ず与える。
 * - ただし「重ならない」。各行で左隣との最小間隔を確保し、行間隔も径以上にする。
 * - この配置はそのまま最終形（物理で settle させず、最初から眠らせて置く）。
 *   → ロード時にカメラが動かない／絵文字層が上下しない。
 * - 古い順に底（groundY 付近）から積み、新しいものほど上に来る。
 *
 * 出力は scripts/check-spec.ts で「ランダム性」と「重なり無し」を自動検証している。
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
// 重なり防止のための最小間隔（径比）。見た目のボール径 ≈ 0.84。
export const MIN_GAP_RATIO = 0.86;

export function computeSeedLayout(entries: EmotionEntry[], opts: SeedLayoutOptions): SeedLayout {
  const { width, ballSize, groundY } = opts;
  const max = opts.max ?? 250;
  const sorted = [...entries]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-max);

  const pitchX = ballSize * 0.92; // 基本ピッチ
  const rowStep = ballSize * 0.9; // 行間（径0.84以上＝縦の重なり防止）
  const minGap = ballSize * MIN_GAP_RATIO; // 同一行・左隣との最小中心間隔
  const minX = ballSize / 2 + 2;
  const maxX = width - ballSize / 2 - 2;
  const cols = Math.max(1, Math.floor(width / pitchX));

  const placements: SeedPlacement[] = [];
  let idx = 0;
  let row = 0;
  let topY = groundY;
  while (idx < sorted.length) {
    const even = row % 2 === 0;
    const n = even ? cols : Math.max(1, cols - 1); // オフセット行は右端の被り防止に1つ減らす
    const base = even ? pitchX / 2 : pitchX;
    const yJitterMax = ballSize * 0.03; // 縦は控えめ（重なり防止のため）
    let prevX = -Infinity;
    for (let c = 0; c < n && idx < sorted.length; c++) {
      const e = sorted[idx++];
      const jx = jitterSeed(e.id, 7) * ballSize * JITTER_X_RATIO;
      const jy = jitterSeed(e.id, 13) * yJitterMax;
      let x = base + c * pitchX + jx;
      // 左隣と重ならないようにクランプ（ランダムだが重なり無し）
      if (c > 0) x = Math.max(x, prevX + minGap);
      x = Math.max(minX, Math.min(maxX, x));
      prevX = x;
      const y = groundY - ballSize / 2 - row * rowStep + jy;
      if (y - ballSize / 2 < topY) topY = y - ballSize / 2;
      placements.push({ emotion: e.emotion, variation: e.variation, x, y });
    }
    row++;
  }
  return { placements, topY };
}
