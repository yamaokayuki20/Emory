/**
 * 仕様デグレ監視（CI で実行）。
 * docs/仕様書.md の INVARIANTS のうち、純粋ロジックで検証できるものを自動チェックする。
 *
 * 実行: node scripts/check-spec.ts （Node 22 の型ストリップで直接実行）
 */
import { computeSeedLayout, JITTER_X_RATIO, MIN_GAP_RATIO } from '../src/layout/seedLayout.ts';

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
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('Spec check: 初期パイル配置');

const ballSize = 46;
const width = 360;
const groundY = 40000;
const { placements } = computeSeedLayout(makeEntries(80) as any, { width, ballSize, groundY });

check('配置が存在する', placements.length > 0, `(len=${placements.length})`);

// INVARIANT 1: ランダム積層（整列していない）
// x 座標がグリッド値に揃っていないこと＝distinct 値が多い／残差の分散が大きい。
const xs = placements.map((p) => p.x);
const distinctX = new Set(xs.map((x) => Math.round(x))).size;
check(
  'ランダム性: x座標がほぼ全てユニーク（整列していない）',
  distinctX >= placements.length * 0.8,
  `(distinct=${distinctX}/${placements.length})`
);

// 横ジッターの実効量（標準偏差）が径の一定割合以上
const stepX = ballSize * 0.92;
const residuals = xs.map((x) => {
  const r = ((x % stepX) + stepX) % stepX;
  return r - stepX / 2; // -stepX/2..stepX/2
});
const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
const std = Math.sqrt(residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / residuals.length);
check(
  '横ジッターが効いている（残差stdが径の5%以上）',
  std > ballSize * 0.05,
  `(std=${std.toFixed(2)}, need>${(ballSize * 0.05).toFixed(2)})`
);

// ジッター設定自体が十分（仕様の下限）
check('JITTER_X_RATIO が下限以上', JITTER_X_RATIO >= 0.12, `(=${JITTER_X_RATIO})`);

// 縦方向にも段（行）がある＝1行に潰れていない
const ys = placements.map((p) => Math.round(p.y));
const distinctRows = new Set(ys.map((y) => Math.round(y / (ballSize * 0.4)))).size;
check('複数行に積まれている', distinctRows >= 3, `(rows~=${distinctRows})`);

// INVARIANT 2: 重ならない（配置時点で同一行の左右が径未満に近接しない）
const diameter = ballSize * 0.84; // 見た目のボール径
let minPairGap = Infinity;
for (const a of placements) {
  for (const b of placements) {
    if (a === b) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < minPairGap) minPairGap = d;
  }
}
check(
  '重なり無し: 最近接中心間距離が見た目の径以上',
  minPairGap >= diameter - 0.5,
  `(min=${minPairGap.toFixed(2)}, need>=${diameter.toFixed(2)})`
);
check('MIN_GAP_RATIO が径以上', MIN_GAP_RATIO >= 0.84, `(=${MIN_GAP_RATIO})`);

if (failed > 0) {
  console.error(`\nSPEC CHECK FAILED: ${failed} 件のデグレを検出`);
  process.exit(1);
}
console.log('\nSpec check OK');
