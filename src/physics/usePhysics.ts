import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

import { EmotionKey } from '../theme/emotions';

export interface RenderBall {
  bodyId: number;
  emotion: EmotionKey;
  variation: number;
  x: number;
  y: number;
  angle: number;
  size: number;
}

interface BallMeta {
  emotion: EmotionKey;
  variation: number;
  size: number;
  flying: boolean;
}

interface Options {
  width: number;
  height: number;
  ballSize?: number;
}

interface PhysicsApi {
  balls: RenderBall[];
  /** 発射点(x,y)から速度(vx,vy)でボールを投げる（飛行のみ・落下で消滅） */
  launch: (
    emotion: EmotionKey,
    variation: number,
    x: number,
    y: number,
    vx: number,
    vy: number
  ) => void;
  /** ターゲットの当たり判定円を設定（吸い込み演出用） */
  setTarget: (t: { x: number; y: number; r: number } | null) => void;
  /** ターゲットにヒット中か */
  targetActive: boolean;
}

const WALL = 60;

/**
 * 投擲エリアの物理。投げたボールの「飛行」だけを扱う。
 * 着地して積み上げるプールは持たない（積み上げは単一のデンスパイル側で表現する）。
 * 画面下に落ちたボールは消滅させる。
 */
export function usePhysics({ width, height, ballSize = 46 }: Options): PhysicsApi {
  const engineRef = useRef<Matter.Engine | null>(null);
  const metaRef = useRef<Map<number, BallMeta>>(new Map());
  const targetRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const [balls, setBalls] = useState<RenderBall[]>([]);
  const [targetActive, setTargetActive] = useState(false);
  const targetActiveRef = useRef(false);
  const wasEmptyRef = useRef(true);

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const engine = Matter.Engine.create();
    engine.gravity.y = 1.1;
    engineRef.current = engine;

    // 左右の壁だけ（地面なし＝落ちたら消える）
    const left = Matter.Bodies.rectangle(-WALL / 2, height / 2, WALL, height * 3, { isStatic: true });
    const right = Matter.Bodies.rectangle(width + WALL / 2, height / 2, WALL, height * 3, {
      isStatic: true,
    });
    Matter.Composite.add(engine.world, [left, right]);

    let last = Date.now();
    let mounted = true;

    const loop = () => {
      if (!mounted) return;
      const now = Date.now();
      const delta = Math.min(32, now - last);
      last = now;
      Matter.Engine.update(engine, delta);

      const tgt = targetRef.current;
      let active = false;
      for (const b of Matter.Composite.allBodies(engine.world)) {
        const meta = metaRef.current.get(b.id);
        if (!meta) continue;
        // ターゲット吸い込み判定
        if (tgt && meta.flying) {
          const dx = b.position.x - tgt.x;
          const dy = b.position.y - tgt.y;
          if (dx * dx + dy * dy < tgt.r * tgt.r) {
            active = true;
            Matter.Body.setVelocity(b, { x: dx * 0.06, y: 2.5 });
            meta.flying = false;
          }
        }
        // 画面下に出たら消滅
        if (b.position.y > height + 120) {
          Matter.Composite.remove(engine.world, b);
          metaRef.current.delete(b.id);
        }
      }
      if (active !== targetActiveRef.current) {
        targetActiveRef.current = active;
        setTargetActive(active);
      }

      const render: RenderBall[] = [];
      for (const b of Matter.Composite.allBodies(engine.world)) {
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
        });
      }
      // 飛行ボールが無い間は再描画しない（毎フレームの再レンダリングを回避）
      if (render.length === 0) {
        if (!wasEmptyRef.current) {
          wasEmptyRef.current = true;
          setBalls([]);
        }
      } else {
        wasEmptyRef.current = false;
        setBalls(render);
      }
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

  const launch = useCallback(
    (emotion: EmotionKey, variation: number, x: number, y: number, vx: number, vy: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const body = Matter.Bodies.circle(x, y, ballSize / 2, {
        restitution: 0.35,
        friction: 0.6,
        frictionAir: 0.01,
        density: 0.0014,
      });
      metaRef.current.set(body.id, { emotion, variation, size: ballSize, flying: true });
      Matter.Composite.add(engine.world, body);
      Matter.Body.setVelocity(body, { x: vx, y: vy });
    },
    [ballSize]
  );

  const setTarget = useCallback((t: { x: number; y: number; r: number } | null) => {
    targetRef.current = t;
  }, []);

  return { balls, launch, setTarget, targetActive };
}
