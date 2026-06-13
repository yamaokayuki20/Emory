/**
 * 仕様デグレ監視（CI で実行）。docs/仕様書.md の INVARIANTS のうち
 * 純粋ロジックで検証できるものを自動チェックする。
 * 実行: node scripts/check-spec.ts （Node 22 の型ストリップで直接実行）
 */
import { computeSeedLayout, BALL_RADIUS_RATIO } from '../src/layout/seedLayout.ts';

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

console.log('Spec check: 初期パイル配置（ドロップ・パッキング）');

const ballSize = 46;
const width = 360;
const groundY = 40000;
const N = 90;
const { placements } = computeSeedLayout(makeEntries(N) as any, { width, ballSize, groundY });

const r = ballSize * BALL_RADIUS_RATIO;
const d = 2 * r; // 接触距離（=見た目の径）

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

// INVARIANT: 重ならない（最近接 >= 径）
check('重なり無し: 最近接中心間距離 >= 径', minNN >= d - 0.6, `(min=${minNN.toFixed(2)}, d=${d.toFixed(2)})`);

// INVARIANT: 隙間が空きすぎない（接して積まれている＝中央値が径に近い）
check('隙間なし: 最近接の中央値が径の1.08倍以内', medianNN <= d * 1.08, `(median=${medianNN.toFixed(2)}, d=${d.toFixed(2)})`);

// INVARIANT: ランダム（整列していない）= y が連続的にばらける（行に潰れない）
const distinctY = new Set(placements.map((p) => Math.round(p.y))).size;
check('ランダム: y がほぼ全てユニーク（行整列でない）', distinctY >= N * 0.6, `(distinctY=${distinctY}/${N})`);

const distinctX = new Set(placements.map((p) => Math.round(p.x))).size;
check('ランダム: x がほぼ全てユニーク', distinctX >= N * 0.8, `(distinctX=${distinctX}/${N})`);

// 物理ボディ半径と一致していること（接触＝見た目接触の前提）
check('BALL_RADIUS_RATIO が見た目に一致(≈0.42)', Math.abs(BALL_RADIUS_RATIO - 0.42) < 0.02, `(=${BALL_RADIUS_RATIO})`);

if (failed > 0) {
  console.error(`\nSPEC CHECK FAILED: ${failed} 件のデグレを検出`);
  process.exit(1);
}
console.log('\nSpec check OK');
