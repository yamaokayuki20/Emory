import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionEntry } from '../storage/entries';
import { EmotionKey } from '../theme/emotions';

export interface RenderBall {
  bodyId: number;
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
  angle: number;
  size: number;
  landed: boolean;
}

interface BallMeta {
  emotion: EmotionKey;
  variation: number;
  size: number;
  landed: boolean;
  flying: boolean;
}

interface Options {
  width: number;
  height: number;
  ballSize?: number;
  /** 着地（プール入り）したときに呼ばれる。記録処理に使う。 */
  onLanded?: (emotion: EmotionKey, variation: number) => void;
}

interface PhysicsApi {
  balls: RenderBall[];
  /** 発射点(x,y)から速度(vx,vy)でボールを投げる */
  launch: (
    emotion: EmotionKey,
    variation: number,
    x: number,
    y: number,
    vx: number,
    vy: number
  ) => void;
  /** 既存エントリを初期プールとして積む */
  seedPool: (entries: EmotionEntry[]) => void;
  /** ターゲットの当たり判定円を設定（吸い込み演出用） */
  setTarget: (t: { x: number; y: number; r: number } | null) => void;
  /** ターゲットにヒット中か */
  targetActive: boolean;
}

const WALL = 60;

export function usePhysics({ width, height, ballSize = 44, onLanded }: Options): PhysicsApi {
  const engineRef = useRef<Matter.Engine | null>(null);
  const metaRef = useRef<Map<number, BallMeta>>(new Map());
  const targetRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  const [balls, setBalls] = useState<RenderBall[]>([]);
  const [targetActive, setTargetActive] = useState(false);
  const targetActiveRef = useRef(false);

  // エンジン初期化
  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const engine = Matter.Engine.create();
    engine.gravity.y = 1.1;
    engineRef.current = engine;

    const ground = Matter.Bodies.rectangle(width / 2, height + WALL / 2, width + WALL * 2, WALL, {
      isStatic: true,
    });
    const left = Matter.Bodies.rectangle(-WALL / 2, height / 2, WALL, height * 3, { isStatic: true });
    const right = Matter.Bodies.rectangle(width + WALL / 2, height / 2, WALL, height * 3, {
      isStatic: true,
    });
    Matter.Composite.add(engine.world, [ground, left, right]);

    let last = Date.now();
    let mounted = true;

    const loop = () => {
      if (!mounted) return;
      const now = Date.now();
      const delta = Math.min(32, now - last);
      last = now;
      Matter.Engine.update(engine, delta);

      // ターゲット吸い込み判定
      const tgt = targetRef.current;
      let active = false;
      const bodies = Matter.Composite.allBodies(engine.world);
      for (const b of bodies) {
        const meta = metaRef.current.get(b.id);
        if (!meta) continue;
        if (tgt && meta.flying) {
          const dx = b.position.x - tgt.x;
          const dy = b.position.y - tgt.y;
          if (dx * dx + dy * dy < tgt.r * tgt.r) {
            active = true;
            // 少し下へ弾いて、その後プールへ落とす
            Matter.Body.setVelocity(b, { x: dx * 0.06, y: 2.5 });
            meta.flying = false;
          }
        }
        // 着地判定（下部に達して十分減速したらプール入り＝記録）
        if (!meta.landed) {
          const speed = Math.hypot(b.velocity.x, b.velocity.y);
          if (b.position.y > height * 0.42 && speed < 0.7) {
            meta.landed = true;
            meta.flying = false;
            onLandedRef.current?.(meta.emotion, meta.variation);
          }
        }
      }
      if (active !== targetActiveRef.current) {
        targetActiveRef.current = active;
        setTargetActive(active);
      }

      // 描画用スナップショット
      const render: RenderBall[] = [];
      for (const b of bodies) {
        const meta = metaRef.current.get(b.id);
        if (!meta) continue;
        render.push({
          bodyId: b.id,
          emotion: meta.emotion,
          variation: meta.variation,
          x: b.position.x,
          y: b.position.y,
          angle: b.angle,
          size: meta.size,
          landed: meta.landed,
        });
      }
      setBalls(render);
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
  }, [width, height]);

  const addBody = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, size: number, flying: boolean) => {
      const engine = engineRef.current;
      if (!engine) return null;
      const body = Matter.Bodies.circle(x, y, size / 2, {
        restitution: 0.35,
        friction: 0.6,
        frictionAir: 0.012,
        density: 0.0014,
      });
      metaRef.current.set(body.id, { emotion, variation, size, landed: !flying, flying });
      Matter.Composite.add(engine.world, body);
      return body;
    },
    []
  );

  const launch = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => {
      const body = addBody(emotion, variation, x, y, ballSize, true);
      if (body) Matter.Body.setVelocity(body, { x: vx, y: vy });
    },
    [addBody, ballSize]
  );

  const seedPool = useCallback(
    (entries: EmotionEntry[]) => {
      if (!engineRef.current) return;
      // 直近のものを下部にランダムに撒いて自然に積ませる
      const recent = entries.slice(-24);
      recent.forEach((e, i) => {
        const x = WALL + ((i * 53) % Math.max(1, width - WALL * 2));
        const y = height * 0.3 + ((i * 37) % (height * 0.3));
        addBody(e.emotion, e.variation, x, y, ballSize, false);
      });
    },
    [addBody, ballSize, width, height]
  );

  const setTarget = useCallback((t: { x: number; y: number; r: number } | null) => {
    targetRef.current = t;
  }, []);

  return { balls, launch, seedPool, setTarget, targetActive };
}
