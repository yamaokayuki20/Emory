import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  LongPressGestureHandler,
  LongPressGestureHandlerStateChangeEvent,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import Svg, { Line, Path } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import EmotionPicker from '../components/EmotionPicker';
import Header from '../components/Header';
import TrajectoryLine from '../components/TrajectoryLine';
import { BasketHoop, Ufo, targetForToday } from '../components/targets';
import { usePhysics } from '../physics/usePhysics';
import { EmotionEntry } from '../storage/entries';
import { consumeThrow, getThrowState } from '../storage/rateLimit';
import { bg, text } from '../theme/colors';
import { EmotionKey, getEmotion } from '../theme/emotions';

interface Props {
  entries: EmotionEntry[];
  onAdd: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
}

const BALL = 46;

// 長押しでスリンガーモードに入るまでの溜め時間
const CHARGE_MS = 2000;
// スリンガーの張力カーブ：引っ張るほど移動距離が縮む（ゴム的な抵抗）
const STRETCH_MAX = 140; // 見かけ上の最大伸び（px）
const STRETCH_K = 78; // 硬さ（大きいほどゆるい）
const STRETCH_TO_VEL = 0.095; // 伸び→発射速度
const VEL_MAX = 14;
// フリック判定
const FLICK_SPEED = 260;

const USE_NATIVE = Platform.OS !== 'web';

/** 張力カーブ。引っ張り量(dx,dy)に対して、頭打ちする見かけの伸びを返す。 */
function tension(dx: number, dy: number) {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.001) return { x: 0, y: 0, mag: 0 };
  const t = STRETCH_MAX * (1 - Math.exp(-mag / STRETCH_K));
  return { x: (dx / mag) * t, y: (dy / mag) * t, mag: t };
}

function AddScreen({ entries, onAdd }: Props) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<EmotionKey>('happy');
  const [memo, setMemo] = useState('');
  const [remaining, setRemaining] = useState(10);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [slinger, setSlinger] = useState(false);
  const seededRef = useRef(false);
  const slingerRef = useRef(false);

  // ジェスチャ同時認識用の参照
  const panRef = useRef(null);
  const longPressRef = useRef(null);

  // エフェクト用アニメーション値
  const charge = useRef(new Animated.Value(0)).current; // 0→1 溜め
  const pop = useRef(new Animated.Value(0)).current; // 起動時のポップ

  const target = useMemo(() => targetForToday(), []);

  const { balls, launch, seedPool, setTarget, targetActive } = usePhysics({
    width: area.w,
    height: area.h,
    ballSize: BALL,
  });

  // 発射点（積み上げの上・操作エリア中段）
  const launchPoint = useMemo(
    () => ({ x: area.w / 2, y: area.h * 0.5 }),
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

  const resetSlinger = useCallback(() => {
    slingerRef.current = false;
    setSlinger(false);
    setDrag(null);
    Animated.parallel([
      Animated.timing(charge, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: USE_NATIVE,
      }),
      Animated.timing(pop, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: USE_NATIVE,
      }),
    ]).start();
  }, [charge, pop]);

  const onGesture = useCallback((e: PanGestureHandlerGestureEvent) => {
    setDrag({ x: e.nativeEvent.translationX, y: e.nativeEvent.translationY });
  }, []);

  const doLaunch = useCallback(
    async (vx: number, vy: number) => {
      const state = await consumeThrow();
      if (!state) {
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

  // 長押し：溜め→スリンガーモード起動
  const onLongPress = useCallback(
    (e: LongPressGestureHandlerStateChangeEvent) => {
      const st = e.nativeEvent.state;
      if (st === State.BEGAN) {
        // 触れた瞬間から溜め開始（CHARGE_MS で満タン）
        charge.setValue(0);
        Animated.timing(charge, {
          toValue: 1,
          duration: CHARGE_MS,
          easing: Easing.linear,
          useNativeDriver: USE_NATIVE,
        }).start();
      } else if (st === State.ACTIVE) {
        // 溜め完了：スリンガーモードへ
        slingerRef.current = true;
        setSlinger(true);
        charge.setValue(1);
        pop.setValue(0);
        Animated.spring(pop, {
          toValue: 1,
          friction: 4,
          tension: 120,
          useNativeDriver: USE_NATIVE,
        }).start();
      } else if (
        st === State.FAILED ||
        st === State.CANCELLED ||
        st === State.END
      ) {
        // スリンガー起動前に離した（＝フリック扱い）→ 溜めを戻す
        if (!slingerRef.current) {
          Animated.timing(charge, {
            toValue: 0,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: USE_NATIVE,
          }).start();
        }
      }
    },
    [charge, pop]
  );

  // パン：フリック発射 or スリンガー発射
  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationX, translationY, velocityX, velocityY } = e.nativeEvent;
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) {
        return;
      }

      if (slingerRef.current) {
        // スリンガー：張力カーブの伸びに比例して、引いた逆向き（上）へ発射
        const s = tension(translationX, translationY);
        if (s.mag > 18) {
          const ux = s.x / s.mag;
          const uy = s.y / s.mag;
          const speed = Math.min(VEL_MAX, s.mag * STRETCH_TO_VEL);
          void doLaunch(-ux * speed, -uy * speed);
        }
        resetSlinger();
        return;
      }

      // フリック：弾いた方向へそのまま飛ばす
      const speed = Math.hypot(velocityX, velocityY);
      if (state === State.END && speed > FLICK_SPEED) {
        const vx = velocityX * 0.013;
        const vy = velocityY * 0.013;
        void doLaunch(vx, vy);
      } else if (state === State.END && translationY < -50) {
        // ゆっくり上へ引いて離す操作も拾う（保険）
        void doLaunch(translationX * 0.05, Math.min(-6, translationY * 0.06));
      }
      setDrag(null);
    },
    [doLaunch, resetSlinger]
  );

  // 見かけの伸び（スリンガー時は張力カーブを適用）
  const stretch = useMemo(() => {
    if (!drag) return { x: 0, y: 0, mag: 0 };
    if (slinger) return tension(drag.x, drag.y);
    return { x: drag.x, y: drag.y, mag: Math.hypot(drag.x, drag.y) };
  }, [drag, slinger]);

  const ballPos = useMemo(
    () => ({ x: launchPoint.x + stretch.x, y: launchPoint.y + stretch.y }),
    [launchPoint, stretch]
  );

  const def = getEmotion(selected);

  const ringScale = charge.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.5] });
  const ringOpacity = charge.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.18, 0.5] });
  const ballScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  // 引くほど帯が細くなる＝張力が限界に近づく演出
  const bandWidth = Math.max(1.5, 7 - stretch.mag / 26);

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

        {/* 溜めエフェクト（発射点から広がるリング） */}
        {area.w > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.chargeRing,
              {
                left: launchPoint.x - BALL,
                top: launchPoint.y - BALL,
                width: BALL * 2,
                height: BALL * 2,
                borderRadius: BALL,
                borderColor: def.color,
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
        )}

        {/* スリンガーの張力帯（発射点→ボール） */}
        {slinger && drag && area.w > 0 && (
          <Svg width={area.w} height={area.h} style={styles.overlay} pointerEvents="none">
            <Line
              x1={launchPoint.x - 13}
              y1={launchPoint.y}
              x2={ballPos.x}
              y2={ballPos.y}
              stroke={def.color}
              strokeWidth={bandWidth}
              strokeLinecap="round"
              opacity={0.55}
            />
            <Line
              x1={launchPoint.x + 13}
              y1={launchPoint.y}
              x2={ballPos.x}
              y2={ballPos.y}
              stroke={def.color}
              strokeWidth={bandWidth}
              strokeLinecap="round"
              opacity={0.55}
            />
          </Svg>
        )}

        {/* 予測軌道（スリンガー時のみ。引いた逆向きに弧を描く） */}
        {slinger && drag && area.w > 0 && (
          <TrajectoryLine
            width={area.w}
            height={area.h}
            from={launchPoint}
            pull={{ x: stretch.x, y: stretch.y }}
            color={def.color}
          />
        )}

        {/* 操作ヒント */}
        {!drag && !slinger && (
          <View style={styles.hint} pointerEvents="none">
            <Svg width={18} height={12} viewBox="0 0 18 12">
              <Path d="M3 9 L9 3 L15 9" stroke={text.faint} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.hintText}>フリックで投げる ・ 長押しでスリンガー</Text>
          </View>
        )}
        {slinger && !drag && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintStrong}>下に引いて離す</Text>
          </View>
        )}

        {/* 待機ボール（フリック＆スリンガーの起点） */}
        {area.w > 0 && (
          <LongPressGestureHandler
            ref={longPressRef}
            minDurationMs={CHARGE_MS}
            maxDist={32}
            simultaneousHandlers={panRef}
            onHandlerStateChange={onLongPress}
          >
            <Animated.View
              style={[
                styles.ready,
                {
                  left: ballPos.x - BALL / 2,
                  top: ballPos.y - BALL / 2,
                  width: BALL,
                  height: BALL,
                  transform: [{ scale: ballScale }],
                },
              ]}
            >
              <PanGestureHandler
                ref={panRef}
                simultaneousHandlers={longPressRef}
                onGestureEvent={onGesture}
                onHandlerStateChange={onPanState}
              >
                <Animated.View style={{ width: BALL, height: BALL }}>
                  <EmotionBall emotion={selected} variation={0} size={BALL} shadow />
                </Animated.View>
              </PanGestureHandler>
            </Animated.View>
          </LongPressGestureHandler>
        )}
      </View>

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
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  target: {
    position: 'absolute',
    width: 96,
    alignItems: 'center',
  },
  ready: {
    position: 'absolute',
  },
  chargeRing: {
    position: 'absolute',
    borderWidth: 2.5,
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '30%',
    alignItems: 'center',
    gap: 4,
  },
  hintText: {
    fontSize: 12,
    color: text.faint,
    letterSpacing: 1,
  },
  hintStrong: {
    fontSize: 13,
    color: text.secondary,
    letterSpacing: 2,
    fontWeight: '600',
  },
  picker: {
    backgroundColor: bg.base,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: bg.line,
  },
});

export default AddScreen;
