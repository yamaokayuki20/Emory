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

// 決定論的な疑似乱数（id をシード, -1..1）
function jitter(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * 2 - 1;
}

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
      const body = Matter.Bodies.circle(x, y, ballSize * 0.42, {
        isStatic,
        restitution: 0.52, // よく弾む（ポンポン）
        friction: 0.45,
        frictionStatic: 0.6,
        frictionAir: 0.008,
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
      // 見た目のボール（余白を除くと径の約0.84）がほぼ接するピッチ。
      // ヘックス＋ジッターでランダムに積まれた見た目にする。
      const stepX = ballSize * 0.84;
      const stepY = ballSize * 0.72;
      const cols = Math.max(1, Math.floor(width / stepX));
      const pitchX = width / cols;
      let idx = 0;
      let row = 0;
      while (idx < sorted.length) {
        const even = row % 2 === 0;
        const n = even ? cols : Math.max(1, cols - 1); // オフセット行は1つ減らして右端の被りを防ぐ
        const base = even ? pitchX / 2 : pitchX;
        for (let c = 0; c < n && idx < sorted.length; c++) {
          const e = sorted[idx++];
          const jx = jitter(e.id, 7) * ballSize * 0.16;
          const jy = jitter(e.id, 13) * ballSize * 0.14;
          let x = base + c * pitchX + jx;
          x = Math.max(ballSize / 2 + 2, Math.min(width - ballSize / 2 - 2, x));
          const y = GROUND_Y - ballSize / 2 - row * stepY + jy;
          addBody(e.emotion, e.variation, x, y, true); // 静的に固定
        }
        row++;
      }
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
