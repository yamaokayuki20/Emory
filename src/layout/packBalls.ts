import { EmotionEntry } from '../storage/entries';

/**
 * アーカイブ用の決定論的な密パック・レイアウト。
 * 日付で区切らず、画面いっぱいに「隙間なくギチギチ」に上から積む（ボールピット風）。
 * ヘックス配置（行ごとに半ピッチずらす）＋わずかなジッターで自然な密集感を出す。
 * 新しい記録ほど上に来る（重力で上に積み上がっていくイメージ）。
 */

export interface PackedBall {
  entry: EmotionEntry;
  x: number; // 中心X
  y: number; // 中心Y
  size: number;
}

export interface PackResult {
  balls: PackedBall[];
  height: number;
}

// 決定論的な疑似乱数（id をシード）
function jitter(seed: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1; // -1..1
}

export interface PackOptions {
  width: number;
  size?: number; // ボール径
  paddingTop?: number;
  colStep?: number; // 横ピッチ係数（<1で重なる）
  rowStep?: number; // 縦ピッチ係数（<1で重なる）
}

export function packBalls(entries: EmotionEntry[], opts: PackOptions): PackResult {
  const size = opts.size ?? 46;
  const width = opts.width;
  const paddingTop = opts.paddingTop ?? 14;
  const colStep = opts.colStep ?? 0.84; // ぎしっと詰める
  const rowStep = opts.rowStep ?? 0.8;

  // 新しい日付が上に来るよう降順
  const sorted = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const stepX = size * colStep;
  const stepY = size * rowStep;
  const cols = Math.max(1, Math.round(width / stepX));
  // 列を画面幅に均等割り付け（端まできっちり詰める）
  const pitchX = width / cols;

  const balls: PackedBall[] = [];
  let idx = 0;
  let row = 0;
  while (idx < sorted.length) {
    const offset = row % 2 === 0 ? 0 : pitchX / 2;
    const y = paddingTop + size / 2 + row * stepY;
    // 奇数行は半ピッチずれるので、はみ出さない範囲で列数を調整
    const rowCols = offset > 0 ? cols : cols;
    for (let c = 0; c < rowCols && idx < sorted.length; c++) {
      const e = sorted[idx++];
      const jx = jitter(e.id, 7) * size * 0.06;
      const jy = jitter(e.id, 13) * size * 0.05;
      let cx = offset + pitchX * c + pitchX / 2 + jx;
      cx = Math.max(size / 2, Math.min(width - size / 2, cx));
      balls.push({ entry: e, x: cx, y: y + jy, size });
    }
    row++;
  }

  const height = paddingTop + size + Math.max(0, row - 1) * stepY + size / 2;
  return { balls, height };
}
