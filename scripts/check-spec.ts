/**
 * 仕様デグレ監視（CI で実行）。docs/仕様書.md の INVARIANTS のうち
 * 純粋ロジックで検証できるものを自動チェックする。
 * 実行: node scripts/check-spec.ts （Node 22 の型ストリップで直接実行）
 */
import { computeSettledPile, VISIBLE_RADIUS_RATIO } from '../src/layout/settlePile.ts';

type Entry = {
  id: string;
  emotion: string;
  variation: number;
  color: string;
  createdAt: string;
};

function makeEntries(n: number): Entry[] {
  const emotions = ['happy', 'excited', 'calm', 'relaxed', 'tired', 'sad', 'anxious', 'irritated'];
  const out: Entry[] = [];
  const base = Date.parse('2026-06-01T09:00:00.000Z');
  for (let i = 0; i < n; i++) {
    out.push({
      id: `seed-${i}-${(i * 2654435761) % 1000003}`,
      emotion: emotions[i % emotions.length],
      variation: i % 4,
      color: '#000',
      createdAt: new Date(base + i * 60000).toISOString(),
    });
  }
  return out;
}

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('Spec check: 初期パイル（重力 settle）');

const ballSize = 46;
const width = 360;
const groundY = 40000;
const N = 90;
const { placements } = computeSettledPile(makeEntries(N) as any, { width, ballSize, groundY });

const visD = 2 * ballSize * VISIBLE_RADIUS_RATIO; // 見た目の径（重なり判定の基準）

check('配置が存在する', placements.length === N, `(len=${placements.length})`);

// 各ボールの最近接中心間距離
const nn: number[] = placements.map((a, i) => {
  let m = Infinity;
  placements.forEach((b, j) => {
    if (i === j) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < m) m = dist;
  });
  return m;
});
const minNN = Math.min(...nn);
const sortedNN = [...nn].sort((a, b) => a - b);
const medianNN = sortedNN[Math.floor(sortedNN.length / 2)];

// INVARIANT: 重ならない（見た目の径より近接しない）
check('重なり無し: 最近接中心間距離 >= 見た目の径', minNN >= visD - 0.6, `(min=${minNN.toFixed(2)}, visD=${visD.toFixed(2)})`);

// INVARIANT: 隙間が空きすぎない（接して積まれている＝中央値が径の1.2倍以内）
check('隙間なし: 最近接の中央値が見た目の径の1.2倍以内', medianNN <= visD * 1.2, `(median=${medianNN.toFixed(2)}, visD=${visD.toFixed(2)})`);

// INVARIANT: ランダム（格子でない）= x,y の取りうる値が多い。
// 完全な格子なら distinct は cols/rows 程度に激減する。settle 済みは多くがユニーク。
const distinctY = new Set(placements.map((p) => Math.round(p.y))).size;
check('ランダム: y が格子でない（distinct多数）', distinctY >= N * 0.4, `(distinctY=${distinctY}/${N})`);

const distinctX = new Set(placements.map((p) => Math.round(p.x))).size;
check('ランダム: x が格子でない（distinct多数）', distinctX >= N * 0.5, `(distinctX=${distinctX}/${N})`);

check('VISIBLE_RADIUS_RATIO が見た目に一致(≈0.42)', Math.abs(VISIBLE_RADIUS_RATIO - 0.42) < 0.02, `(=${VISIBLE_RADIUS_RATIO})`);

if (failed > 0) {
  console.error(`\nSPEC CHECK FAILED: ${failed} 件のデグレを検出`);
  process.exit(1);
}
console.log('\nSpec check OK');
