import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionEntry } from '../storage/entries';
import { EmotionKey } from '../theme/emotions';
import { computeSettledPile } from '../layout/settlePile';

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
  restTopY: number; // 着地済みの山の最上端（飛行中は無視）
  activeCount: number; // 動いているボール数
  groundY: number;
  drop: (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => void;
  seed: (entries: EmotionEntry[]) => void;
  setTarget: (t: { x: number; y: number; r: number } | null) => void;
  consumeHit: () => { x: number; y: number } | null;
}

const WALL = 80;
const GROUND_Y = 40000; // 箱の底（ワールド）。山はここから上へ積み上がる。
// 山頂からこの深さ（径の倍数）までを「動的に反応する上層」とし、それより下の
// 眠りボールは静的に固定する（負荷軽減・崩れ防止）。固定層を表面に近づける。
const ACTIVE_DEPTH_ROWS = 2;
// 固定からさらにこの深さより下のボールは物理ワールドから除去（描画だけ残す）。
// 浅め＝物理に残るボディを「上層＋薄い床帯」だけに束ね、総数に依存させない（性能の要）。
const REMOVE_EXTRA_ROWS = 2;
// 当たり判定＝見た目の径＋1px（重ならないための最小間隔）。
const GAP_PX = 1;
// 描画・追跡する固定ボールの上限（画面外に流れた古いものは破棄＝総数非依存に保つ）。
const MAX_FROZEN = 180;

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
  const rafRef = useRef<number | null>(null);
  const seededRef = useRef(false);
  // 固定済み（静的・除去済み含む）ボールの描画データ。位置不変・y昇順。
  const frozenMapRef = useRef<Map<number, BoxBall>>(new Map());
  const frozenSortedRef = useRef<BoxBall[]>([]);

  const [balls, setBalls] = useState<BoxBall[]>([]);
  const [frozenVersion, setFrozenVersion] = useState(0);
  const restTopRef = useRef(GROUND_Y);
  const [meta, setMeta] = useState({ restTopY: GROUND_Y, activeCount: 0 });

  useEffect(() => {
    if (width <= 0) return;
    const engine = Matter.Engine.create();
    engine.enableSleeping = true;
    engine.gravity.y = 1.0;
    // 衝突解決を強めて、強い衝突でも食い込み（重なり）を残さない
    engine.positionIterations = 20;
    engine.velocityIterations = 12;
    engineRef.current = engine;

    const ground = Matter.Bodies.rectangle(width / 2, GROUND_Y + 40, width + WALL * 2, 80, { isStatic: true });
    const left = Matter.Bodies.rectangle(-WALL / 2, GROUND_Y - 20000, WALL, 60000, { isStatic: true });
    const right = Matter.Bodies.rectangle(width + WALL / 2, GROUND_Y - 20000, WALL, 60000, { isStatic: true });
    Matter.Composite.add(engine.world, [ground, left, right]);

    let last = Date.now();
    let mounted = true;
    let prevActive = -1;

    const loop = () => {
      if (!mounted) return;
      const now = Date.now();
      const delta = Math.min(32, now - last);
      last = now;
      Matter.Engine.update(engine, delta);

      // デペネトレーション: 接触ペアが「見た目の径+1px」より近ければ直接押し離す。
      // matter の接触情報(engine.pairs)だけを使うので軽量。動的ボールの重なりを能動解消。
      const minSep = ballSize * 0.84 + GAP_PX;
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
        const push = overlap * 0.6; // ゆるく（数フレームで解消）
        if (!a.isStatic && !b.isStatic) {
          Matter.Body.translate(a, { x: -nx * push * 0.5, y: -ny * push * 0.5 });
          Matter.Body.translate(b, { x: nx * push * 0.5, y: ny * push * 0.5 });
        } else if (!a.isStatic) {
          Matter.Body.translate(a, { x: -nx * push, y: -ny * push });
        } else if (!b.isStatic) {
          Matter.Body.translate(b, { x: nx * push, y: ny * push });
        }
      }

      const tgt = targetRef.current;
      let activeCount = 0;
      let settledTop = Infinity;
      const freezeLine = restTopRef.current + ballSize * ACTIVE_DEPTH_ROWS;
      const removeLine = restTopRef.current + ballSize * (ACTIVE_DEPTH_ROWS + REMOVE_EXTRA_ROWS);
      const allBodies = Matter.Composite.allBodies(engine.world);
      // 固定は「見た目で重なっていない（中心間が見た目の径以上）」時だけ。
      // 体半径(0.44)は見た目(0.42)より大きいので、わずかな食い込みは見た目重なりにならない。
      const overlapDist2 = (ballSize * 0.84) ** 2;
      const dynamicRender: BoxBall[] = [];
      const toRemove: Matter.Body[] = [];
      let frozenChanged = false;

      for (const b of allBodies) {
        const m = metaRef.current.get(b.id);
        if (!m) continue; // 壁・地面
        const top = b.position.y - m.size / 2;

        if (b.isStatic) {
          // 固定済み（床帯）。位置不変。深すぎるものは物理から除去（描画は frozenMap に残る）。
          if (top < settledTop) settledTop = top;
          if (b.position.y > removeLine) toRemove.push(b);
          continue;
        }

        if (b.isSleeping) {
          if (top < settledTop) settledTop = top;
          // 深い眠りボールは固定（重なっている間は固定しない）
          if (b.position.y > freezeLine) {
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
          if (tgt && !m.hitUfo) {
            const dx = b.position.x - tgt.x;
            const dy = b.position.y - tgt.y;
            if (dx * dx + dy * dy < tgt.r * tgt.r) {
              m.hitUfo = true;
              hitRef.current = { x: tgt.x, y: tgt.y };
            }
          }
        }
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

      // 配列再確保なし。版だけ進めて変化を通知（消費側は frozenVersion を依存に）。
      if (frozenChanged) setFrozenVersion((v) => v + 1);

      // 動的が居る間だけ動的層を更新（アイドル時は再描画しない）
      if (activeCount > 0 || prevActive !== 0) {
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
      frozenSortedRef.current = [];
    };
  }, [width]);

  const addBody = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const body = Matter.Bodies.circle(x, y, ballSize * 0.44, {
        restitution: 0.12,
        friction: 0.7,
        frictionStatic: 1.0,
        frictionAir: 0.012,
        density: 0.0016,
        slop: 0.002,
      });
      body.sleepThreshold = 20; // 早めに眠らせる→早く固定→動的数を抑える
      metaRef.current.set(body.id, { emotion, variation, size: ballSize, hitUfo: false });
      Matter.Composite.add(engine.world, body);
      return body;
    },
    [ballSize]
  );

  const drop = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => {
      const body = addBody(emotion, variation, x, y);
      if (body) Matter.Body.setVelocity(body, { x: vx, y: vy });
    },
    [addBody]
  );

  const seed = useCallback(
    (entries: EmotionEntry[]) => {
      if (seededRef.current || !engineRef.current || width <= 0) return;
      seededRef.current = true;
      const { placements, topY } = computeSettledPile(entries, { width, ballSize, groundY: GROUND_Y });
      for (const p of placements) {
        const body = addBody(p.emotion, p.variation, p.x, p.y);
        if (body) Matter.Sleeping.set(body, true);
      }
      restTopRef.current = topY;
      setMeta({ restTopY: topY, activeCount: 0 });
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

  return {
    balls,
    frozenSorted: frozenSortedRef.current,
    frozenVersion,
    restTopY: meta.restTopY,
    activeCount: meta.activeCount,
    groundY: GROUND_Y,
    drop,
    seed,
    setTarget,
    consumeHit,
  };
}
