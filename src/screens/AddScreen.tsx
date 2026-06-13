import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import EmotionPicker from '../components/EmotionPicker';
import Header from '../components/Header';
import TrajectoryLine from '../components/TrajectoryLine';
import { BasketHoop, Ufo, targetForToday } from '../components/targets';
import { usePhysics } from '../physics/usePhysics';
import { EmotionEntry } from '../storage/entries';
import { consumeThrow, getThrowState } from '../storage/rateLimit';
import { bg, text } from '../theme/colors';
import { EmotionKey, getEmotion, variationForId } from '../theme/emotions';

interface Props {
  entries: EmotionEntry[];
  onAdd: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
}

const BALL = 46;

function AddScreen({ entries, onAdd }: Props) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<EmotionKey>('happy');
  const [memo, setMemo] = useState('');
  const [remaining, setRemaining] = useState(10);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const seededRef = useRef(false);

  const target = useMemo(() => targetForToday(), []);

  const { balls, launch, seedPool, setTarget, targetActive } = usePhysics({
    width: area.w,
    height: area.h,
    ballSize: BALL,
  });

  // 発射点（操作エリア下部中央）
  const launchPoint = useMemo(
    () => ({ x: area.w / 2, y: area.h * 0.78 }),
    [area.w, area.h]
  );

  // ターゲットの絶対座標
  const targetPos = useMemo(
    () => ({ x: area.w * target.anchor.x, y: area.h * target.anchor.y }),
    [area.w, area.h, target]
  );

  // 残数読み込み
  useEffect(() => {
    getThrowState().then((s) => setRemaining(s.remaining));
  }, []);

  // 初期プール投入
  useEffect(() => {
    if (!seededRef.current && area.w > 0 && entries.length > 0) {
      seededRef.current = true;
      seedPool(entries);
    }
  }, [area.w, entries, seedPool]);

  // ターゲット当たり判定を登録
  useEffect(() => {
    if (area.w > 0) setTarget({ x: targetPos.x, y: targetPos.y, r: target.hitRadius });
  }, [area.w, targetPos, target.hitRadius, setTarget]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  }, []);

  const onGesture = useCallback((e: PanGestureHandlerGestureEvent) => {
    setDrag({ x: e.nativeEvent.translationX, y: e.nativeEvent.translationY });
  }, []);

  const doLaunch = useCallback(
    async (vx: number, vy: number) => {
      const state = await consumeThrow();
      if (!state) {
        // 枠切れ: 控えめに何もしない（残数表示が0のまま）
        setRemaining(0);
        return;
      }
      setRemaining(state.remaining);
      const entry = await onAdd(selected, memo);
      launch(selected, entry.variation, launchPoint.x, launchPoint.y, vx, vy);
      setMemo('');
    },
    [selected, memo, onAdd, launch, launchPoint]
  );

  const onStateChange = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationX, translationY, velocityX, velocityY } = e.nativeEvent;
      if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
        const tx = translationX;
        const ty = translationY;
        // 上方向の意図（フリックまたはドラッグ）を検出
        const flickUp = velocityY < -200;
        const dragUp = ty < -40;
        if ((flickUp || dragUp) && state === State.END) {
          // 発射速度 = ジェスチャ速度 + 引っ張り変位（上向き）
          const vx = velocityX * 0.012 + tx * 0.06;
          const vy = Math.min(-6, velocityY * 0.012 + ty * 0.06);
          void doLaunch(vx, vy);
        }
        setDrag(null);
      }
    },
    [doLaunch]
  );

  const readyPos = useMemo(() => {
    if (!drag) return launchPoint;
    return { x: launchPoint.x + drag.x, y: launchPoint.y + drag.y };
  }, [drag, launchPoint]);

  const def = getEmotion(selected);
  const readyVariation = 0;

  return (
    <View style={styles.screen}>
      <Header remaining={remaining} />

      <View style={styles.playArea} onLayout={onLayout}>
        {/* ターゲット（日替わり） */}
        {area.w > 0 && (
          <View
            style={[
              styles.target,
              { left: targetPos.x - 48, top: targetPos.y - 30 },
            ]}
            pointerEvents="none"
          >
            {target.kind === 'ufo' ? (
              <Ufo size={96} active={targetActive} />
            ) : (
              <BasketHoop size={96} active={targetActive} />
            )}
          </View>
        )}

        {/* 物理ボール（飛行中＋プール） */}
        {balls.map((b) => (
          <EmotionBall
            key={b.bodyId}
            emotion={b.emotion}
            variation={b.variation}
            size={b.size}
            style={{
              position: 'absolute',
              left: b.x - b.size / 2,
              top: b.y - b.size / 2,
              transform: [{ rotate: `${b.angle}rad` }],
            }}
          />
        ))}

        {/* ドラッグ中の軌道線 */}
        {drag && area.w > 0 && (
          <TrajectoryLine
            width={area.w}
            height={area.h}
            from={launchPoint}
            pull={{ x: -drag.x, y: -drag.y }}
            color={def.color}
          />
        )}

        {/* 操作ヒント */}
        {!drag && (
          <View style={styles.hint} pointerEvents="none">
            <Svg width={18} height={12} viewBox="0 0 18 12">
              <Path d="M3 9 L9 3 L15 9" stroke={text.faint} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.hintText}>上にドラッグまたはフリック</Text>
          </View>
        )}

        {/* スリングショットの待機ボール */}
        {area.w > 0 && (
          <PanGestureHandler onGestureEvent={onGesture} onHandlerStateChange={onStateChange}>
            <View
              style={[
                styles.ready,
                { left: readyPos.x - BALL / 2, top: readyPos.y - BALL / 2, width: BALL, height: BALL },
              ]}
            >
              <EmotionBall emotion={selected} variation={readyVariation} size={BALL} shadow />
            </View>
          </PanGestureHandler>
        )}
      </View>

      {/* 下部 ~1/5: これから積み上げる感情の入口（プールは playArea 底に表示） */}
      <View style={styles.poolHint} pointerEvents="none" />

      <View style={styles.picker}>
        <EmotionPicker selected={selected} onSelect={setSelected} memo={memo} onChangeMemo={setMemo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: bg.base,
    paddingTop: 8,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  target: {
    position: 'absolute',
    width: 96,
    alignItems: 'center',
  },
  ready: {
    position: 'absolute',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '32%',
    alignItems: 'center',
    gap: 4,
  },
  hintText: {
    fontSize: 12,
    color: text.faint,
    letterSpacing: 1,
  },
  poolHint: {
    height: 0,
  },
  picker: {
    backgroundColor: bg.base,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: bg.line,
  },
});

export default AddScreen;
