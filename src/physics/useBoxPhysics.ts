import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionEntry } from '../storage/entries';
import { EmotionKey } from '../theme/emotions';
import { computeSeedLayout } from '../layout/seedLayout';

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
  balls: BoxBall[];
  restTopY: number; // 着地済みの山の最上端（飛行中は無視）
  activeCount: number; // 動いているボール数
  groundY: number;
  /** 箱に1つ投入（ワールド座標 x,y と初速 vx,vy） */
  drop: (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => void;
  /** 既存エントリを底から積んで初期化（1度だけ） */
  seed: (entries: EmotionEntry[]) => void;
  setTarget: (t: { x: number; y: number; r: number } | null) => void;
  /** ターゲット命中の立ち上がり（命中したワールド座標を返す。無ければ null） */
  consumeHit: () => { x: number; y: number } | null;
}

const WALL = 80;
const GROUND_Y = 40000; // 箱の底（ワールド）。山はここから上へ積み上がる。
// 山頂からこの深さ（ボール径の倍数）までを「動的に反応する上層」とし、
// それより下の眠ったボールは静的に固定する（要調整ポイント）。
const ACTIVE_DEPTH_ROWS = 6;

/**
 * 縦長の「箱」を1つの物理ワールドとして扱う。
 * - 下に重力。底に積もり、下ほどギチギチ。
 * - enableSleeping で落ち着いたボールは眠らせ、上部のアクティブな物理だけ回す。
 */
export function useBoxPhysics({ width, ballSize = 46 }: Options): BoxApi {
  const engineRef = useRef<Matter.Engine | null>(null);
  const metaRef = useRef<Map<number, BallMeta>>(new Map());
  const targetRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const hitRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const seededRef = useRef(false);

  const [balls, setBalls] = useState<BoxBall[]>([]);
  const restTopRef = useRef(GROUND_Y);
  const [meta, setMeta] = useState({ restTopY: GROUND_Y, activeCount: 0 });

  useEffect(() => {
    if (width <= 0) return;
    const engine = Matter.Engine.create();
    engine.enableSleeping = true;
    engine.gravity.y = 1.0;
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

      const tgt = targetRef.current;
      let activeCount = 0;
      let settledTop = Infinity; // 着地済み（静的 or 眠り）の最上端
      // 山頂から一定の深さより下の眠りボールは静的化（下層は固定、上層だけ動的）
      const freezeLine = restTopRef.current + ballSize * ACTIVE_DEPTH_ROWS;
      const render: BoxBall[] = [];
      for (const b of Matter.Composite.allBodies(engine.world)) {
        const m = metaRef.current.get(b.id);
        if (!m) continue;
        const top = b.position.y - m.size / 2;
        const settled = b.isStatic || b.isSleeping;
        if (settled) {
          if (top < settledTop) settledTop = top;
          // 深い位置の眠りボールは固定（上層だけ動的に残す）
          if (!b.isStatic && b.isSleeping && b.position.y > freezeLine) {
            Matter.Body.setStatic(b, true);
          }
        } else {
          activeCount++;
          // ターゲット命中（上昇中に1回だけ）
          if (tgt && !m.hitUfo) {
            const dx = b.position.x - tgt.x;
            const dy = b.position.y - tgt.y;
            if (dx * dx + dy * dy < tgt.r * tgt.r) {
              m.hitUfo = true;
              hitRef.current = { x: tgt.x, y: tgt.y };
            }
          }
        }
        render.push({
          bodyId: b.id,
          emotion: m.emotion,
          variation: m.variation,
          x: b.position.x,
          y: b.position.y,
          angle: b.angle,
          size: m.size,
        });
      }
      // カメラ基準は「着地済み」の最上端のみ。落下中/跳ね中は無視（追わない）。
      // 着地球がまだ無い間は前の値を保持する。
      if (settledTop !== Infinity) restTopRef.current = settledTop;

      // アクティブが居る間だけ描画更新（アイドル時は再描画しない）
      if (activeCount > 0 || prevActive !== 0) {
        setBalls(render);
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
    };
  }, [width]);

  const addBody = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      // 当たり半径を見た目のボール（径の約0.84＝半径0.42）に合わせ、
      // slop を小さくして「絶対に重ならない」。固定はしない（動的＝衝撃に反応）。
      const body = Matter.Bodies.circle(x, y, ballSize * 0.42, {
        restitution: 0.32, // 軽く弾む（高すぎると不安定なので控えめ）
        friction: 0.55,
        frictionStatic: 0.8,
        frictionAir: 0.01,
        density: 0.0016,
        slop: 0.005,
      });
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
      // ランダムに積み上がった配置（純粋関数。デグレ監視は scripts/check-spec.ts）。
      const { placements, topY } = computeSeedLayout(entries, {
        width,
        ballSize,
        groundY: GROUND_Y,
      });
      // 最初から眠らせて置く＝ロード時に settle で揺れない／カメラが動かない。
      // 動的なので衝突時は wake して反応する。配置自体が重なり無し。
      for (const p of placements) {
        const body = addBody(p.emotion, p.variation, p.x, p.y);
        if (body) Matter.Sleeping.set(body, true);
      }
      // 初期のカメラ基準＝配置した山頂
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
    restTopY: meta.restTopY,
    activeCount: meta.activeCount,
    groundY: GROUND_Y,
    drop,
    seed,
    setTarget,
    consumeHit,
  };
}
