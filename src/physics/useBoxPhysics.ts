import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionEntry } from '../storage/entries';
import { EmotionKey } from '../theme/emotions';

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
      let restTop = Infinity; // 着地済み（静的）ボールの最上端
      const render: BoxBall[] = [];
      for (const b of Matter.Composite.allBodies(engine.world)) {
        const m = metaRef.current.get(b.id);
        if (!m) continue;
        // 落ち着いた（眠った）動的ボールは静的に固定して、以後崩れ・浮きを防ぐ
        if (!b.isStatic && b.isSleeping) {
          Matter.Body.setStatic(b, true);
        }
        const settled = b.isStatic;
        if (settled) {
          if (b.position.y - m.size / 2 < restTop) restTop = b.position.y - m.size / 2;
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
      if (restTop !== Infinity) restTopRef.current = restTop;

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
    (emotion: EmotionKey, variation: number, x: number, y: number, isStatic: boolean) => {
      const engine = engineRef.current;
      if (!engine) return;
      const body = Matter.Bodies.circle(x, y, ballSize * 0.5, {
        isStatic,
        restitution: 0.12,
        friction: 0.9,
        frictionStatic: 1.4,
        frictionAir: 0.012,
        density: 0.0016,
        slop: 0.02,
      });
      metaRef.current.set(body.id, { emotion, variation, size: ballSize, hitUfo: false });
      Matter.Composite.add(engine.world, body);
      return body;
    },
    [ballSize]
  );

  const drop = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => {
      const body = addBody(emotion, variation, x, y, false);
      if (body) Matter.Body.setVelocity(body, { x: vx, y: vy });
    },
    [addBody]
  );

  const seed = useCallback(
    (entries: EmotionEntry[]) => {
      if (seededRef.current || !engineRef.current || width <= 0) return;
      seededRef.current = true;
      // 古い順に底から積む（新しいものほど上）
      const sorted = [...entries].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const stepX = ballSize * 1.0;
      const stepY = ballSize * 0.9;
      const cols = Math.max(1, Math.floor(width / stepX));
      const pitchX = width / cols;
      sorted.forEach((e, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const offset = row % 2 === 0 ? 0 : pitchX / 2;
        let x = offset + pitchX * col + pitchX / 2;
        x = Math.max(ballSize / 2 + 2, Math.min(width - ballSize / 2 - 2, x));
        const y = GROUND_Y - ballSize / 2 - row * stepY;
        addBody(e.emotion, e.variation, x, y, true); // 静的に固定
      });
      // 初期描画
      const render: BoxBall[] = [];
      let pileTop = GROUND_Y;
      for (const b of Matter.Composite.allBodies(engineRef.current.world)) {
        const m = metaRef.current.get(b.id);
        if (!m) continue;
        if (b.position.y - m.size / 2 < pileTop) pileTop = b.position.y - m.size / 2;
        render.push({ bodyId: b.id, emotion: m.emotion, variation: m.variation, x: b.position.x, y: b.position.y, angle: b.angle, size: m.size });
      }
      restTopRef.current = pileTop;
      setBalls(render);
      setMeta({ restTopY: pileTop, activeCount: 0 });
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
