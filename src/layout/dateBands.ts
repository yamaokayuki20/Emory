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
  /** 「今日」の dayKey。これに一致する日(=ライブ層)だけ上境界を引かない。未指定なら最新日を今日扱い。 */
  todayKey?: string;
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
  // このアルゴリズムは「全件を一時ワールドで日毎 settle ＋ O(N²) デペネトレーション」で、
  // N が大きいと急激に重くなる（実測: N=600 で読み込みが数十秒〜タイムアウト）。よって
  // ここで配置する件数の安全上限は 200 に保つ（これ以上は読み込みが固まり、settle も
  // 破綻して下層が重なる）。数ヶ月分（>200）の遡り表示は Phase 3 の「日毎・増分ベイク
  // （今日の帯だけ計算・過去日は永続化を再利用）」で O(N²) を消してから引き上げる。
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
  const allBodies: Matter.Body[] = []; // 全ボディ（最終的に重なり無く落ち着かせてから記録）
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
      (body as unknown as { _e: EmotionEntry; _key: string })._e = e;
      (body as unknown as { _e: EmotionEntry; _key: string })._key = g.key;
      dayBodies.push(body);
      allBodies.push(body);
      Matter.Composite.add(engine.world, body);
    });
    for (let s = 0; s < stepsPerDay; s++) Matter.Engine.update(engine, 16);

    // この日の上端だけ求めて、次の日の積み始め高さにする。
    // 境界線は全日 settle 後に「最終位置」から日と日の継ぎ目を縫って引く（後述）。
    let dayTop = pileTop;
    dayBodies.forEach((b) => { const top = b.position.y - r; if (top < dayTop) dayTop = top; });
    pileTop = dayTop;
  });

  // 全日を積んだ後、しっかり settle。
  for (let s = 0; s < 160; s++) Matter.Engine.update(engine, 16);

  // 仕上げに「重力なしの純粋デペネトレーション」で重なりを完全に解消する。
  // 重力ありのままだと押し離しても次のステップで再圧縮されて重なりが残るため、
  // ここでは Engine.update を回さず、近接ペアを押し離す緩和だけを反復して収束させる。
  const minSep = 2 * r + 1; // 体半径×2（=接触）＋1px。これより近ければ押し離す。
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let a = 0; a < allBodies.length; a++) {
      for (let b = a + 1; b < allBodies.length; b++) {
        const A = allBodies[a], B = allBodies[b];
        const dx = B.position.x - A.position.x, dy = B.position.y - A.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const ov = minSep - dist;
        if (ov <= 0.2) continue;
        const nx = dx / dist, ny = dy / dist, p = ov * 0.5;
        Matter.Body.setPosition(A, { x: A.position.x - nx * p, y: A.position.y - ny * p });
        Matter.Body.setPosition(B, { x: B.position.x + nx * p, y: B.position.y + ny * p });
        moved = true;
      }
    }
    // x を箱内に収め直す
    for (const b of allBodies) Matter.Body.setPosition(b, { x: Math.max(minX, Math.min(maxX, b.position.x)), y: b.position.y });
    if (!moved) break;
  }

  // 最終位置で配置を記録（重なり解消後）。topY も最終位置から再計算。
  let topY = groundY;
  for (const b of allBodies) {
    const m = b as unknown as { _e: EmotionEntry; _key: string };
    placements.push({ emotion: m._e.emotion, variation: m._e.variation, x: b.position.x, y: b.position.y, dateKey: m._key });
    if (b.position.y - r < topY) topY = b.position.y - r;
  }

  // ── 日付境界線を最終位置から引く（日と日の継ぎ目を縫う＝両側の玉に被らない）。
  const byDay = new Map<string, Matter.Body[]>();
  for (const b of allBodies) {
    const k = (b as unknown as { _key: string })._key;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(b);
  }
  const todayKeyResolved = opts.todayKey != null ? opts.todayKey : (groups.length ? groups[groups.length - 1].key : '');
  // 最新の過去日(=昨日)の index。「昨日」の上には線を引かない（一昨日から引く）。
  let newestPast = -1;
  groups.forEach((g, gi) => { if (g.key !== todayKeyResolved) newestPast = gi; });

  const colOf = (x: number) => Math.max(0, Math.min(NB - 1, Math.floor(x / bucketW)));
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (g.key === todayKeyResolved) continue; // 今日には上線なし
    if (gi === newestPast) continue;          // 昨日の上線は引かない（#1）
    const lower = byDay.get(g.key) || [];                 // この日（下側）
    const upper = gi + 1 < groups.length ? byDay.get(groups[gi + 1].key) || [] : []; // 次の新しい日（上側）
    const lowTop = new Array<number>(NB).fill(NaN); // 下の日の上面（最小 y - r）
    const upBot = new Array<number>(NB).fill(NaN);  // 上の日の下面（最大 y + r）
    for (const b of lower) { const bi = colOf(b.position.x); const t = b.position.y - r; if (isNaN(lowTop[bi]) || t < lowTop[bi]) lowTop[bi] = t; }
    for (const b of upper) { const bi = colOf(b.position.x); const bo = b.position.y + r; if (isNaN(upBot[bi]) || bo > upBot[bi]) upBot[bi] = bo; }
    // 下の日の上面の欠損を近傍で補間（線を連続させる）。
    for (let i = 1; i < NB; i++) if (isNaN(lowTop[i]) && !isNaN(lowTop[i - 1])) lowTop[i] = lowTop[i - 1];
    for (let i = NB - 2; i >= 0; i--) if (isNaN(lowTop[i]) && !isNaN(lowTop[i + 1])) lowTop[i] = lowTop[i + 1];
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < NB; i++) {
      const lt = lowTop[i];
      if (isNaN(lt)) continue;
      const ub = upBot[i];
      // 上の日の下面が下の日の上面より高い（=隙間あり）なら中点を縫う。隙間が無ければ
      // 下の日の上面のすぐ上に置く（下の日を貫かない最小限のクリアランス）。
      const y = !isNaN(ub) && ub < lt - 1 ? (lt + ub) / 2 : lt - ballSize * 0.16;
      pts.push({ x: (i + 0.5) * bucketW, y });
    }
    if (pts.length >= 2) boundaries.push({ dateKey: g.key, label: g.label, points: pts, pillY: pts[pts.length - 1].y });
  }

  Matter.World.clear(engine.world, false);
  Matter.Engine.clear(engine);

  return { placements, boundaries, topY };
}
