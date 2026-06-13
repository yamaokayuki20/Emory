import { EmotionEntry } from '../storage/entries';

/**
 * アーカイブ用の決定論的な密パック・レイアウト。
 * カードやグリッドではなく「画面いっぱいにギチギチに詰まった」見た目を、
 * 行ごとにオフセットを付けたヘックス配置＋わずかなジッターで表現する。
 * 日付ごとにまとめて配置し、各日の帯の境界 y を返す。
 */

export interface PackedBall {
  entry: EmotionEntry;
  x: number; // 中心X
  y: number; // 中心Y
  size: number;
}

export interface DateBand {
  label: string; // 例: 5/18
  key: string; // YYYY-MM-DD
  // 帯の上端Y（点線・日付ピルをここに置く）
  top: number;
  centerY: number;
}

export interface PackResult {
  balls: PackedBall[];
  bands: DateBand[];
  height: number;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
  bandGap?: number; // 日付帯の間隔
  rowOverlap?: number; // 行を詰める係数（0=隙間なめ、正で重なる）
}

export function packBalls(entries: EmotionEntry[], opts: PackOptions): PackResult {
  const size = opts.size ?? 46;
  const width = opts.width;
  const paddingTop = opts.paddingTop ?? 20;
  const bandGap = opts.bandGap ?? 26;
  const rowOverlap = opts.rowOverlap ?? 0.14;

  // 新しい日付が上に来るよう降順でグループ化
  const sorted = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const groups: { key: string; label: string; items: EmotionEntry[] }[] = [];
  for (const e of sorted) {
    const k = dayKey(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(e);
    else groups.push({ key: k, label: dayLabel(e.createdAt), items: [e] });
  }

  const cols = Math.max(1, Math.floor(width / (size * 0.92)));
  const stepX = width / cols;
  const rowH = size * (1 - rowOverlap);

  const balls: PackedBall[] = [];
  const bands: DateBand[] = [];
  let y = paddingTop;

  for (const g of groups) {
    const bandTop = y - bandGap * 0.5;
    bands.push({ label: g.label, key: g.key, top: bandTop, centerY: y });

    const items = g.items;
    let idx = 0;
    let row = 0;
    while (idx < items.length) {
      const offset = row % 2 === 0 ? 0 : stepX / 2;
      for (let c = 0; c < cols && idx < items.length; c++) {
        const e = items[idx++];
        const jx = jitter(e.id, 7) * size * 0.1;
        const jy = jitter(e.id, 13) * size * 0.08;
        let cx = offset + stepX * c + stepX / 2 + jx;
        // 端のはみ出しを軽く内側へ
        cx = Math.max(size / 2, Math.min(width - size / 2, cx));
        balls.push({ entry: e, x: cx, y: y + rowH / 2 + jy, size });
      }
      y += rowH;
      row++;
    }
    y += bandGap;
  }

  return { balls, bands, height: y + size };
}
