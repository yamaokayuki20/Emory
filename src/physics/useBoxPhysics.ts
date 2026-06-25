import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionEntry } from '../storage/entries';
import { EmotionKey } from '../theme/emotions';
import { DateBoundary } from '../layout/dateBands';
import { loadOrComputeBandedPile } from '../layout/pileCache';
import { todayKey } from '../state/clock';

export interface BoxBall {
  bodyId: number;
  emotion: EmotionKey;
  variation: number;
  x: number; // ワールド座標（中心）
  y: number;
  angle: number;
  size: number;
}

interface BallMeta {
  emotion: EmotionKey;
  variation: number;
  size: number;
  hitUfo: boolean;
  hitGoal: boolean;
  prevY: number; // 前フレームのy（リング面の上→下クロス判定用）
}

interface Options {
  width: number;
  ballSize?: number;
}

interface BoxApi {
  /** 動的（飛行中＋上層の眠り）ボール。毎フレーム更新。 */
  balls: BoxBall[];
  /** 固定済み（静的）ボール。y昇順・位置不変。参照は安定、変化は frozenVersion で通知。 */
  frozenSorted: BoxBall[];
  frozenVersion: number;
  boundaries: DateBoundary[];
  restTopY: number; // 着地済みの山の最上端（飛行中は無視）
  activeCount: number; // 動いているボール数
  groundY: number;
  drop: (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => void;
  seed: (entries: EmotionEntry[]) => void;
  setTarget: (t: { x: number; y: number; r: number } | null) => void;
  consumeHit: () => { x: number; y: number } | null;
  /** バスケ（固定ゴール）の当たり判定円 */
  setGoal: (t: { x: number; y: number; r: number } | null) => void;
  consumeGoalHit: () => { x: number; y: number } | null;
  /** ワールドx における山の「局所表面」ワールドy（無ければ底）。生成可否判定に使う。 */
  surfaceYAt: (x: number) => number;
}

const WALL = 80;
const GROUND_Y = 40000; // 箱の底（ワールド）。山はここから上へ積み上がる。
// 山頂からこの深さ（径の倍数）までを「動的に反応する上層」とし、それより下の
// 眠りボールは静的に固定する（負荷軽減・崩れ防止）。固定層を表面に近づける。
const ACTIVE_DEPTH_ROWS = 2;
// 【案2】固定した直後に動的層へ残すフレーム数（固定層 <img> がロードし終わるまでの保険）。
const RETAIN_FRAMES = 4;
// 固定からさらにこの深さより下のボールは物理ワールドから除去（描画だけ残す）。
// 「表面から十分深い＝落としたボールが届かない（=すり抜けない）」深さに設定。通常サイズの
// 山は丸ごと物理として残り、巨大な山のときだけ最深部を除去して物理ボディ数を頭打ちにする。
const REMOVE_EXTRA_ROWS = 26;
// 当たり判定＝見た目の径＋1px（重ならないための最小間隔）。
const GAP_PX = 1;
// 描画・追跡する固定ボールの安全上限。描画は visibleSlice で画面内スライスだけに窓化され、
// 物理ボディは removeDepth で表面付近に限定されるため、総数が増えても DOM も物理も増えない
// （＝重くならない）。よってこの上限は「際限ない肥大の保険」であり、実使用（保存履歴は
// MAX_STORED_ENTRIES で上限）では決して当たらない高い値にする。下層の記録を捨てない（#13/#11）。
const MAX_FROZEN = 20000;

/** y昇順を保ったまま挿入（二分探索）。固定ボールは位置不変なので順序も不変。 */
function insertSortedByY(arr: BoxBall[], b: BoxBall) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].y < b.y) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, b);
}

/** b が（見た目の径で）他のボールと重なっているか。重なり固定の防止に使う。 */
function overlapsNeighbor(
  b: Matter.Body,
  bodies: Matter.Body[],
  meta: Map<number, BallMeta>,
  minDist2: number
): boolean {
  const bx = b.position.x;
  const by = b.position.y;
  for (const o of bodies) {
    if (o.id === b.id || !meta.has(o.id)) continue;
    const dx = o.position.x - bx;
    const dy = o.position.y - by;
    if (dx * dx + dy * dy < minDist2) return true;
  }
  return false;
}

export function useBoxPhysics({ width, ballSize = 46 }: Options): BoxApi {
  const engineRef = useRef<Matter.Engine | null>(null);
  const metaRef = useRef<Map<number, BallMeta>>(new Map());
  const targetRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const hitRef = useRef<{ x: number; y: number } | null>(null);
  const goalRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const goalHitRef = useRef<{ x: number; y: number } | null>(null);
  // バスケのリム＝物理障害物。goal に毎フレーム追従。A=手前(左)の円、B=右側の斜め板。
  const rimARef = useRef<Matter.Body | null>(null);
  const rimBRef = useRef<Matter.Body | null>(null);
  const rafRef = useRef<number | null>(null);
  const seededRef = useRef(false);
  // 固定済み（静的・除去済み含む）ボールの描画データ。位置不変・y昇順。
  const frozenMapRef = useRef<Map<number, BoxBall>>(new Map());
  const frozenSortedRef = useRef<BoxBall[]>([]);
  // 【案2】固定した直後だけ、動的層にも数フレーム残す（クロス）。固定層に新しい <img> が
  // マウントされてロードし終わるまで、動的層側の（既にロード済みの）コピーを同じ位置に
  // 重ねて表示し続ける → 固定層 <img> の初フレームの空白(=点滅)が見えなくなる。
  // 位置は固定後の確定位置なのでズレない。物理（固定/除去判定）には一切触れない。
  const retainRef = useRef<Map<number, { ball: BoxBall; left: number }>>(new Map());
  // 列ごとの表面高さ（ワールドy）。毎フレーム更新。生成可否（層内への落下防止）に使う。
  const colTopRef = useRef<{ tops: number[]; colW: number } | null>(null);
  // 自己テスト用: 直近に落としたボディ（すり抜け検出）。
  const lastDropRef = useRef<Matter.Body | null>(null);

  const [balls, setBalls] = useState<BoxBall[]>([]);
  const [frozenVersion, setFrozenVersion] = useState(0);
  const [boundaries, setBoundaries] = useState<DateBoundary[]>([]);
  const restTopRef = useRef(GROUND_Y);
  const [meta, setMeta] = useState({ restTopY: GROUND_Y, activeCount: 0 });

  useEffect(() => {
    if (width <= 0) return;
    const engine = Matter.Engine.create();
    engine.enableSleeping = true;
    engine.gravity.y = 1.0;
    // 衝突解決の反復はしっかり（食い込み＝重なりを残さない）。
    engine.positionIterations = 18;
    engine.velocityIterations = 12;
    engineRef.current = engine;

    const ground = Matter.Bodies.rectangle(width / 2, GROUND_Y + 40, width + WALL * 2, 80, { isStatic: true });
    const left = Matter.Bodies.rectangle(-WALL / 2, GROUND_Y - 20000, WALL, 60000, { isStatic: true });
    const right = Matter.Bodies.rectangle(width + WALL / 2, GROUND_Y - 20000, WALL, 60000, { isStatic: true });
    Matter.Composite.add(engine.world, [ground, left, right]);

    let mounted = true;
    let prevActive = -1;

    // すり抜け防止: matter.js は CCD 非対応のため、速く落下するボールは積層の隙間を
    // 飛び越えて貫通する。matter の velocity は「1ステップの移動量(px)」なので、
    // 「下向き(=積層へ突っ込む方向)の1ステップ移動量」をボール径の〜1/6に制限すれば、
    // 必ずどこかのボールに接触して表面に積まれる。投擲は上向き/横向きなので、
    // 上向き速度は制限せず（＝バスケへ届く飛距離を保つ）、落下と横方向だけ抑える。
    // matter の velocity は「1ステップの移動量(px)」。これがボール径に近いと、CCD非対応の
    // matter では積層の隙間を飛び越えて貫通する。貫通は「積層へ突っ込む＝下降中」に起きる。
    // そこで【下降中(vy>0)は“総”速度をボール径の〜1/6に制限】（斜め進入の貫通も防ぐ）、
    // 【上昇/水平＝投擲は勢いを残す】。投擲は上昇で遠くへ飛び、落下は遅いので必ず積まれる。
    // 固定タイムステップで correction≈1 のため、この制限がそのまま1ステップ移動量になる。
    // matter は CCD 非対応のため、1ステップ移動量(velocity)がボール径に近いと積層の隙間を
    // 飛び越えて貫通する。総移動量をボール径の〜1/5に制限すると、必ずどこかに接触して
    // 表面に積まれる（実測で安定して貫通0）。投擲はこの上限内で勢いを付ける。
    const VMAX = ballSize * 0.18; // ≈8.3px/step（少し速く。貫通しない範囲の上限付近）
    const VMAX2 = VMAX * VMAX;
    // 固定タイムステップ。matter は correction=delta/lastDelta で前回比に速度を伸縮させる
    // ため、可変フレーム間隔だと移動量がスパイクして貫通する。常に一定にして correction≈1。
    const FIXED_DELTA = 16;
    // 描画フレームレートからシミュレーションを切り離す。実経過時間ぶんだけ固定16msステップを
    // 進めるので、端末が60fps未満（大量の山など）でも落下/積み上げの速度が壁時計で一定に保たれる
    // （＝以前の落下速度を維持）。重い時はステップ数を上限で打ち切りスローモーションに留め、
    // スパイラル（追いつけず更に重くなる）を防ぐ。1ステップ移動量は VMAX で制限済み＝多段でも貫通しない。
    const MAX_SUBSTEPS = 5;
    let simLast = performance.now();
    let simAcc = 0;

    const minSep = ballSize * 0.84 + GAP_PX;
    const stepSim = () => {
      // 速度キャップ（1ステップ移動量をボール径の〜1/5に制限＝貫通防止）。
      for (const b of Matter.Composite.allBodies(engine.world)) {
        if (b.isStatic || !metaRef.current.has(b.id)) continue;
        const v = b.velocity;
        const s2 = v.x * v.x + v.y * v.y;
        if (s2 > VMAX2) {
          const s = Math.sqrt(s2);
          Matter.Body.setVelocity(b, { x: (v.x / s) * VMAX, y: (v.y / s) * VMAX });
        }
      }
      Matter.Engine.update(engine, FIXED_DELTA);

      // デペネトレーション: 接触ペアが「見た目の径+1px」より近ければ直接押し離す。
      // matter の接触情報(engine.pairs)だけを使うので軽量。動的ボールの重なりを能動解消。
      const pairs = engine.pairs.list;
      for (let pi = 0; pi < pairs.length; pi++) {
        const pair = pairs[pi];
        if (!pair.isActive) continue;
        const a = pair.bodyA;
        const b = pair.bodyB;
        if (!metaRef.current.has(a.id) || !metaRef.current.has(b.id)) continue; // 壁/地面は除外
        let dx = b.position.x - a.position.x;
        let dy = b.position.y - a.position.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const overlap = minSep - dist;
        if (overlap <= 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = overlap * 0.6; // ゆるく（数フレームで解消。強すぎると下のボールを押し込む）
        if (!a.isStatic && !b.isStatic) {
          Matter.Body.translate(a, { x: -nx * push * 0.5, y: -ny * push * 0.5 });
          Matter.Body.translate(b, { x: nx * push * 0.5, y: ny * push * 0.5 });
        } else if (!a.isStatic) {
          Matter.Body.translate(a, { x: -nx * push, y: -ny * push });
        } else if (!b.isStatic) {
          Matter.Body.translate(b, { x: nx * push, y: ny * push });
        }
      }
    };

    const loop = () => {
      if (!mounted) return;

      // 実経過時間ぶんだけ固定ステップを進める（フレームレート非依存）。
      const nowT = performance.now();
      let frameDt = nowT - simLast;
      simLast = nowT;
      if (frameDt > 100) frameDt = 100; // タブ復帰等の巨大ギャップを抑制
      simAcc += frameDt;
      let substeps = 0;
      while (simAcc >= FIXED_DELTA && substeps < MAX_SUBSTEPS) {
        stepSim();
        simAcc -= FIXED_DELTA;
        substeps++;
      }
      if (substeps >= MAX_SUBSTEPS) simAcc = 0; // 重すぎ：余剰を捨てる（スローモーション許容）

      // バスケのリング＝物理障害物。縁に当たればバウンド・中央を上から抜けた時だけスコア。
      // 左リム=小さな円。右リム=「斜めの板」にする(#5)。ゴールが画面右端ぴったりのため
      // 右側に普通の円を置くと壁との間に絵文字が挟まって固着→山頂と誤認→画面せり上がり、に
      // なる。斜め板なら当たり判定は残しつつ、乗った絵文字は中央側へ滑り落ちて固着しない。
      const goalNow = goalRef.current;
      if (goalNow) {
        const rimR = ballSize * 0.07;
        // 右リム=細い斜め板。中央のスコア・レーン(|dx|<0.7r)に被らないよう、リング右端より
        // さらに右へ寄せて配置。右上→左下に傾斜し、乗った絵文字は中央側へ滑り落ちる。
        const rampW = ballSize * 0.5, rampH = ballSize * 0.14, rampAngle = -0.6;
        const rampX = goalNow.x + goalNow.r + ballSize * 0.18;
        if (!rimARef.current || !rimBRef.current) {
          rimARef.current = Matter.Bodies.circle(goalNow.x - goalNow.r, goalNow.y, rimR, {
            isStatic: true, restitution: 0.3, friction: 0, frictionStatic: 0,
          });
          rimBRef.current = Matter.Bodies.rectangle(rampX, goalNow.y, rampW, rampH, {
            isStatic: true, restitution: 0.3, friction: 0, frictionStatic: 0, angle: rampAngle,
          });
          Matter.Composite.add(engine.world, [rimARef.current, rimBRef.current]);
        } else {
          Matter.Body.setPosition(rimARef.current, { x: goalNow.x - goalNow.r, y: goalNow.y });
          Matter.Body.setPosition(rimBRef.current, { x: rampX, y: goalNow.y });
        }
      } else if (rimARef.current || rimBRef.current) {
        if (rimARef.current) Matter.Composite.remove(engine.world, rimARef.current);
        if (rimBRef.current) Matter.Composite.remove(engine.world, rimBRef.current);
        rimARef.current = null;
        rimBRef.current = null;
      }

      const tgt = targetRef.current;
      let activeCount = 0;
      let settledTop = Infinity;
      const allBodies = Matter.Composite.allBodies(engine.world);
      // 固定は「見た目で重なっていない（中心間が見た目の径以上）」時だけ＝固定層を綺麗に保つ。
      const overlapDist2 = (ballSize * 0.84) ** 2;

      // ── 列ごとの「表面の高さ」を求める（パス1）。
      // 山は3層構造で扱う:
      //   ①動的層（飛行中＋浅い眠り, depth<freezeDepth）= 物理あり・毎フレーム更新
      //   ②固定層（depth freezeDepth..removeDepth）= 物理あり・静的（崩れない・着地できる）
      //   ③除去層（depth>removeDepth）= 物理なし・描画のみ（負荷軽減）
      // 列を「半ボール幅」と細かく取り、各ボールの深さは“自分の真上(同一細列)の表面”から
      // 測る。こうすると「自分の真上に十分積まれている」ボールだけが③へ落ちる＝③が
      // どのxでも表面に露出しない（＝落としたボールが必ず物理層①②に着地し、すり抜けない）。
      const NCOL = Math.max(1, Math.round(width / (ballSize * 0.5)));
      const colW = width / NCOL;
      const colTop = new Array<number>(NCOL).fill(Infinity);
      // 「落ち着いた層（静的＋眠り）」だけの表面。飛行中ボールのすり抜け検出に使う。
      const settledTopCol = new Array<number>(NCOL).fill(Infinity);
      const colOf = (x: number) => {
        let ci = Math.floor(x / colW);
        if (ci < 0) ci = 0;
        else if (ci >= NCOL) ci = NCOL - 1;
        return ci;
      };
      for (const b of allBodies) {
        const m = metaRef.current.get(b.id);
        if (!m) continue; // 壁・地面・リム
        const ci = colOf(b.position.x);
        const top = b.position.y - m.size / 2;
        if (top < colTop[ci]) colTop[ci] = top;
        if ((b.isStatic || b.isSleeping) && top < settledTopCol[ci]) settledTopCol[ci] = top;
      }
      colTopRef.current = { tops: colTop, colW }; // 生成可否判定用に公開
      // settledTopCol の隙間/端を近傍で埋める（検出用の連続な表面）。
      for (let i = 1; i < NCOL; i++) if (!isFinite(settledTopCol[i]) && isFinite(settledTopCol[i - 1])) settledTopCol[i] = settledTopCol[i - 1];
      for (let i = NCOL - 2; i >= 0; i--) if (!isFinite(settledTopCol[i]) && isFinite(settledTopCol[i + 1])) settledTopCol[i] = settledTopCol[i + 1];
      const freezeDepth = ballSize * ACTIVE_DEPTH_ROWS;
      const removeDepth = ballSize * (ACTIVE_DEPTH_ROWS + REMOVE_EXTRA_ROWS);

      const dynamicRender: BoxBall[] = [];
      const toRemove: Matter.Body[] = [];
      let frozenChanged = false;
      // 飛行中ボールが「落ち着いた層の表面」よりどれだけ深く沈んでいるか（すり抜け検出）。
      let maxSink = 0;
      let maxBallSink = 0; // 非静的ボールの「落ち着いた層の表面」からの最大沈み込み（すり抜け監視）

      for (const b of allBodies) {
        const m = metaRef.current.get(b.id);
        if (!m) continue; // 壁・地面・リム
        const top = b.position.y - m.size / 2;
        let ci = Math.floor(b.position.x / colW);
        if (ci < 0) ci = 0;
        else if (ci >= NCOL) ci = NCOL - 1;
        const depth = b.position.y - colTop[ci]; // 局所表面からの深さ
        // ゴール周辺で止まっているボールは「山頂(restTop)」に数えない。さもないと、リム上の
        // 1個を山頂と誤認してカメラがせり上がる。restTop は実際の山のためだけに使う。
        const goalC = goalRef.current;
        const nearGoal =
          goalC != null &&
          Math.abs(b.position.y - goalC.y) < ballSize * 1.8 &&
          Math.abs(b.position.x - goalC.x) < goalC.r + ballSize;

        if (b.isStatic) {
          // 固定済み（床帯）。位置不変。局所表面より十分深い（厚い固定層の下）ものだけ
          // 物理から除去（描画は frozenMap に残る）。固定層を厚く保ち、貫通を防ぐ。
          if (!nearGoal && top < settledTop) settledTop = top;
          if (depth > removeDepth) toRemove.push(b);
          continue;
        }

        // すり抜け安全網（限定版）: 「飛行中(=眠っていない)」かつ「落ち着いた層の表面より
        // 物理層の底(removeDepth)を超えて深い」ボールだけ引き戻す。眠っている/落ち着いた
        // ボールには触れないので、山を潰さない（=以前の増殖・重なりを起こさない）。
        // 速い連投で軟らかい列を掘り抜けても、除去層へ落ちる前にここで止まる。
        const settledSurf = settledTopCol[ci];
        if (isFinite(settledSurf)) {
          const sink2 = b.position.y - settledSurf;
          if (sink2 > maxBallSink) maxBallSink = sink2;
          if (!b.isSleeping && sink2 > removeDepth) {
            Matter.Body.setPosition(b, { x: b.position.x, y: settledSurf + removeDepth });
            if (b.velocity.y > 0) Matter.Body.setVelocity(b, { x: b.velocity.x, y: 0 });
          }
        }

        if (b.isSleeping) {
          if (!nearGoal && top < settledTop) settledTop = top;
          // 局所表面より深い眠りボールは固定（重なっている間は固定しない＝固定層を綺麗に保つ）。
          if (depth > freezeDepth) {
            if (!overlapsNeighbor(b, allBodies, metaRef.current, overlapDist2)) {
              Matter.Body.setStatic(b, true);
              const fb: BoxBall = {
                bodyId: b.id,
                emotion: m.emotion,
                variation: m.variation,
                x: b.position.x,
                y: b.position.y,
                angle: b.angle,
                size: m.size,
              };
              frozenMapRef.current.set(b.id, fb);
              insertSortedByY(frozenSortedRef.current, fb); // y昇順を維持
              // 【案2】動的層にも数フレーム残す（固定層 <img> のロード待ちクロス）。
              retainRef.current.set(b.id, { ball: fb, left: RETAIN_FRAMES });
              // 上限超過：最も深い（=最古・画面外下）ものを破棄して総数を頭打ちに
              while (frozenSortedRef.current.length > MAX_FROZEN) {
                const old = frozenSortedRef.current.pop();
                if (old) frozenMapRef.current.delete(old.bodyId);
              }
              frozenChanged = true;
              continue; // 固定したので動的層には入れない
            } else {
              Matter.Sleeping.set(b, false);
            }
          }
        } else {
          activeCount++;
          // すり抜け検出: 「落ち着いた層の表面より深く」かつ「まだ速く落下中」のボール。
          // （着地の衝撃で起こされただけの深いボールは vy≈0 なので除外。）
          const st = settledTopCol[ci];
          if (isFinite(st) && b.velocity.y > 3) {
            const sink = b.position.y - st;
            if (sink > maxSink) maxSink = sink;
          }
          if (tgt && !m.hitUfo) {
            const dx = b.position.x - tgt.x;
            const dy = b.position.y - tgt.y;
            if (dx * dx + dy * dy < tgt.r * tgt.r) {
              m.hitUfo = true;
              hitRef.current = { x: tgt.x, y: tgt.y };
            }
          }
          // バスケ：リングの中央を「上から下へ」抜けた時だけスコア。
          const goal = goalRef.current;
          if (goal && !m.hitGoal) {
            const dx = b.position.x - goal.x;
            const crossedDown = m.prevY < goal.y && b.position.y >= goal.y; // リング面を上→下に通過
            if (crossedDown && b.velocity.y > 0.4 && Math.abs(dx) < goal.r * 0.7) {
              m.hitGoal = true;
              goalHitRef.current = { x: goal.x, y: goal.y };
            }
          }
        }
        m.prevY = b.position.y;
        // 動的（飛行中／上層の眠り）だけ毎フレーム描画
        dynamicRender.push({
          bodyId: b.id,
          emotion: m.emotion,
          variation: m.variation,
          x: b.position.x,
          y: b.position.y,
          angle: b.angle,
          size: m.size,
        });
      }

      // 深い固定ボールを物理ワールドから除去（描画は frozenMap に残す）
      for (const b of toRemove) {
        Matter.Composite.remove(engine.world, b);
        metaRef.current.delete(b.id);
      }

      if (settledTop !== Infinity) restTopRef.current = settledTop;

      // 自己テスト用フック（実害なし・O(1)）。
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __emoryFrameSink?: number; __emoryMaxBallSink?: number; __emoryLastDrop?: unknown; __emoryFrozenCount?: number };
        w.__emoryFrameSink = Math.round(maxSink);
        w.__emoryMaxBallSink = Math.round(maxBallSink);
        w.__emoryFrozenCount = frozenSortedRef.current.length;
        // 自己テスト用: 固定(描画専用含む)ボール全部のワールド座標ダンプ。重なり計測に使う。
        // 再マウント(日付送り)後も“現在のインスタンス”を指すよう毎フレーム貼り直す（ガードしない）。
        const ww = window as unknown as { __emoryFrozenDump?: () => number[][]; __emoryAllDump?: () => number[][] };
        ww.__emoryFrozenDump = () => frozenSortedRef.current.map((b) => [Math.round(b.x), Math.round(b.y)]);
        // 全ボール（物理に残る active/sleeping/static ＋ 描画専用の固定）のワールド座標。
        ww.__emoryAllDump = () => {
          const out: number[][] = [];
          const eng = engineRef.current;
          if (eng) for (const b of Matter.Composite.allBodies(eng.world)) if (metaRef.current.has(b.id)) out.push([Math.round(b.position.x), Math.round(b.position.y)]);
          frozenMapRef.current.forEach((fb) => { if (!metaRef.current.has(fb.bodyId)) out.push([Math.round(fb.x), Math.round(fb.y)]); });
          return out;
        };
        // 直近に落としたボールの沈み込み: その列の他ボール表面(settledTopCol)よりどれだけ深いか。
        // 表面に積まれていれば ~0、層を貫通して下へ落ちると大きい。
        const ld = lastDropRef.current;
        if (ld) {
          const lci = colOf(ld.position.x);
          const surfWorld = isFinite(settledTopCol[lci]) ? settledTopCol[lci] : ld.position.y;
          // cover: 落としたボールの「真上(横±0.6径)」に重なっている描画ボール数（除去層も含む）。
          // 表面に積まれていれば 0。すり抜けて潜り込むと >0（＝上を通り抜けた証拠）。
          const lx = ld.position.x, ly = ld.position.y, hx = ballSize * 0.6, vy = ballSize * 0.7;
          let cover = 0;
          for (const bb of allBodies) { if (bb.id === ld.id || !metaRef.current.has(bb.id)) continue; if (Math.abs(bb.position.x - lx) < hx && bb.position.y < ly - vy) cover++; }
          frozenMapRef.current.forEach((fb) => { if (fb.bodyId === ld.id || metaRef.current.has(fb.bodyId)) return; if (Math.abs(fb.x - lx) < hx && fb.y < ly - vy) cover++; });
          w.__emoryLastDrop = { y: Math.round(ld.position.y), sink: Math.round(ld.position.y - surfWorld), cover, vyDown: ld.velocity.y, sleeping: ld.isSleeping };
        }
      }

      // 配列再確保なし。版だけ進めて変化を通知（消費側は frozenVersion を依存に）。
      if (frozenChanged) setFrozenVersion((v) => v + 1);

      // 【案2】固定直後のボールを動的層にも残す（数フレームのクロス）。位置は固定済みなので
      // ズレない。固定層の新 <img> がロードし終えるまで重ねておき、その後動的層から外す。
      // 保持満了のフレームでは push せず削除し、flush フラグで setBalls を必ず走らせて
      // 動的層から確実に取り除く（古いコピーを残さない＝b45 のカクつき再発を防ぐ）。
      const retain = retainRef.current;
      let retainFlush = false;
      if (retain.size > 0) {
        for (const [id, r] of retain) {
          if (r.left <= 0) { retain.delete(id); retainFlush = true; continue; }
          dynamicRender.push(r.ball);
          r.left--;
        }
      }

      // 動的層を更新する条件: 動いている / 直前まで動いていた / このフレームで固定が起きた /
      // クロス保持中 / 保持満了で取り除いた（flush）。
      if (activeCount > 0 || prevActive !== 0 || frozenChanged || retain.size > 0 || retainFlush) {
        setBalls(dynamicRender);
        setMeta({ restTopY: restTopRef.current, activeCount });
      }
      prevActive = activeCount;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      mounted = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
      metaRef.current.clear();
      frozenMapRef.current.clear();
      retainRef.current.clear();
      frozenSortedRef.current = [];
      rimARef.current = null;
      rimBRef.current = null;
    };
  }, [width]);

  const addBody = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const body = Matter.Bodies.circle(x, y, ballSize * 0.44, {
        restitution: 0.08, // 弱め（着地で周囲を揺らしにくい）。0に近すぎると重なりが残るので少し残す
        friction: 0.7,
        frictionStatic: 1.0,
        frictionAir: 0.012,
        density: 0.0016,
        slop: 0.002,
      });
      body.sleepThreshold = 16; // 早めに眠らせる→早く固定→揺れを早く止める
      metaRef.current.set(body.id, { emotion, variation, size: ballSize, hitUfo: false, hitGoal: false, prevY: y });
      Matter.Composite.add(engine.world, body);
      return body;
    },
    [ballSize]
  );

  const drop = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => {
      const body = addBody(emotion, variation, x, y);
      if (body) {
        Matter.Body.setVelocity(body, { x: vx, y: vy });
        lastDropRef.current = body;
      }
    },
    [addBody]
  );

  const seed = useCallback(
    (entries: EmotionEntry[]) => {
      if (seededRef.current || !engineRef.current || width <= 0) return;
      seededRef.current = true;
      // 【Phase 1】ベイク済みレイアウトを永続キャッシュから読む（無ければ計算して保存）。
      // 物理 settle を起動毎に回さない。位置・境界・見た目は computeDateBandedPile と同一。
      loadOrComputeBandedPile(entries, { width, ballSize, groundY: GROUND_Y, todayKey: todayKey() })
        .then(({ placements, boundaries, topY }) => {
          // await 中にアンマウント/再初期化された場合は中断（再シードできるようフラグを戻す）。
          if (!engineRef.current) {
            seededRef.current = false;
            return;
          }
          for (const p of placements) {
            const body = addBody(p.emotion, p.variation, p.x, p.y);
            if (body) Matter.Sleeping.set(body, true);
          }
          restTopRef.current = topY;
          setBoundaries(boundaries);
          setMeta({ restTopY: topY, activeCount: 0 });
        })
        .catch(() => {
          seededRef.current = false;
        });
    },
    [addBody, ballSize, width]
  );

  const setTarget = useCallback((t: { x: number; y: number; r: number } | null) => {
    targetRef.current = t;
  }, []);

  const consumeHit = useCallback(() => {
    const h = hitRef.current;
    hitRef.current = null;
    return h;
  }, []);

  const setGoal = useCallback((t: { x: number; y: number; r: number } | null) => {
    goalRef.current = t;
  }, []);

  const consumeGoalHit = useCallback(() => {
    const h = goalHitRef.current;
    goalHitRef.current = null;
    return h;
  }, []);

  // ワールドx の局所表面ワールドy。
  // 空き列（その列にボールが無い）は左右の有効な列から推定（隙間・端でも山の表面を
  // 連続的に扱う）。山全体が空のときだけ底（GROUND_Y）。
  //  → 「層の隙間や端の低い所をタップしても生成しない」を担保する。
  const surfaceYAt = useCallback((x: number) => {
    const c = colTopRef.current;
    if (!c || c.tops.length === 0) return GROUND_Y;
    const n = c.tops.length;
    let ci = Math.floor(x / c.colW);
    if (ci < 0) ci = 0;
    else if (ci >= n) ci = n - 1;
    if (isFinite(c.tops[ci])) return c.tops[ci];
    // 空き列：左右の最も近い有効列を探して補間／端は外挿。
    let l = ci - 1;
    while (l >= 0 && !isFinite(c.tops[l])) l--;
    let r = ci + 1;
    while (r < n && !isFinite(c.tops[r])) r++;
    const lv = l >= 0 ? c.tops[l] : NaN;
    const rv = r < n ? c.tops[r] : NaN;
    if (isNaN(lv) && isNaN(rv)) return GROUND_Y; // 完全に空
    if (isNaN(lv)) return rv;
    if (isNaN(rv)) return lv;
    return lv + (rv - lv) * ((ci - l) / (r - l)); // 線形補間
  }, []);

  return {
    balls,
    frozenSorted: frozenSortedRef.current,
    frozenVersion,
    boundaries,
    restTopY: meta.restTopY,
    activeCount: meta.activeCount,
    groundY: GROUND_Y,
    drop,
    seed,
    setTarget,
    consumeHit,
    setGoal,
    consumeGoalHit,
    surfaceYAt,
  };
}
