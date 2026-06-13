import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import Svg, { Line, Path } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import EmotionPicker from '../components/EmotionPicker';
import Fireworks from '../components/Fireworks';
import Header from '../components/Header';
import TrajectoryLine from '../components/TrajectoryLine';
import { BasketHoop, Ufo, targetForToday } from '../components/targets';
import { usePhysics } from '../physics/usePhysics';
import { EmotionEntry } from '../storage/entries';
import { consumeThrow, getThrowState, isDebugUnlimited, setDebugUnlimited } from '../storage/rateLimit';
import { bg, text } from '../theme/colors';
import { EmotionKey, getEmotion } from '../theme/emotions';
import ArchiveScreen from './ArchiveScreen';

interface Props {
  entries: EmotionEntry[];
  onAdd: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
}

const BALL = 46;
const SCREEN_H = Dimensions.get('window').height;
const THROW_H = Math.max(200, Math.round(SCREEN_H * 0.3));

// スリンガーの張力カーブ：引っ張るほど移動距離が縮む（ゴム的な抵抗）
const STRETCH_MAX = 140; // 見かけ上の最大伸び（px）
const STRETCH_K = 78; // 硬さ（大きいほどゆるい）
const STRETCH_TO_VEL = 0.14; // 伸び→発射速度（従来比 約1.5倍）
const VEL_MAX = 21;

// UFO（往復するマイクロインタラクション）
const UFO_SIZE = 58;
const UFO_Y = 0.22; // スロー領域の上部
const UFO_OFF = 70;
const PATROL_MS = 5200;
const RESPAWN_MS = 2200;

/** 張力カーブ。引っ張り量(dx,dy)に対して、頭打ちする見かけの伸びを返す。 */
function tension(dx: number, dy: number) {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.001) return { x: 0, y: 0, mag: 0 };
  const t = STRETCH_MAX * (1 - Math.exp(-mag / STRETCH_K));
  return { x: (dx / mag) * t, y: (dy / mag) * t, mag: t };
}

function AddScreen({ entries, onAdd }: Props) {
  const [area, setArea] = useState({ w: 0, h: THROW_H });
  const [selected, setSelected] = useState<EmotionKey>('happy');
  const [memo, setMemo] = useState('');
  const [remaining, setRemaining] = useState(10);
  const [unlimited, setUnlimited] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // UFO 往復＆撃破
  const ufoX = useRef(new Animated.Value(0)).current;
  const [ufoVisible, setUfoVisible] = useState(true);
  const ufoVisibleRef = useRef(true);
  const ufoPosRef = useRef({ x: 0, y: 0 });
  const [burst, setBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const prevActiveRef = useRef(false);
  const respawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = useMemo(() => targetForToday(), []);

  const { balls, launch, setTarget, targetActive } = usePhysics({
    width: area.w,
    height: area.h,
    ballSize: BALL,
  });

  // 発射点（スロー領域の中段）
  const launchPoint = useMemo(() => ({ x: area.w / 2, y: area.h * 0.6 }), [area.w, area.h]);

  // 残数・デバッグフラグ読み込み
  useEffect(() => {
    getThrowState().then((s) => setRemaining(s.remaining));
    isDebugUnlimited().then(setUnlimited);
  }, []);

  // UFO 往復アニメーション
  useEffect(() => {
    if (area.w <= 0) return;
    ufoX.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ufoX, { toValue: 1, duration: PATROL_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(ufoX, { toValue: 0, duration: PATROL_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [area.w, area.h, ufoX]);

  // UFO 位置に追従してターゲット当たり判定を更新
  useEffect(() => {
    if (area.w <= 0) return;
    const y = area.h * UFO_Y;
    const id = ufoX.addListener(({ value }) => {
      const x = -UFO_OFF + value * (area.w + UFO_OFF * 2);
      ufoPosRef.current = { x, y };
      if (ufoVisibleRef.current) setTarget({ x, y, r: target.hitRadius });
      else setTarget(null);
    });
    return () => ufoX.removeListener(id);
  }, [area.w, area.h, target.hitRadius, setTarget, ufoX]);

  // 命中の立ち上がりで花火＋UFO消滅＋再出現
  useEffect(() => {
    if (targetActive && !prevActiveRef.current && ufoVisibleRef.current) {
      const { x, y } = ufoPosRef.current;
      setBurst({ key: Date.now(), x, y });
      ufoVisibleRef.current = false;
      setUfoVisible(false);
      setTarget(null);
      if (respawnTimer.current) clearTimeout(respawnTimer.current);
      respawnTimer.current = setTimeout(() => {
        ufoVisibleRef.current = true;
        setUfoVisible(true);
      }, RESPAWN_MS);
    }
    prevActiveRef.current = targetActive;
  }, [targetActive, setTarget]);

  useEffect(() => () => {
    if (respawnTimer.current) clearTimeout(respawnTimer.current);
  }, []);

  const onZoneLayout = useCallback((e: LayoutChangeEvent) => {
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

  // パン：ドラッグ＝スリンガー。引いた逆向き（上）へ発射。
  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationX, translationY } = e.nativeEvent;
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;
      const s = tension(translationX, translationY);
      if (state === State.END && s.mag > 18) {
        const ux = s.x / s.mag;
        const uy = s.y / s.mag;
        const speed = Math.min(VEL_MAX, s.mag * STRETCH_TO_VEL);
        void doLaunch(-ux * speed, -uy * speed);
      }
      setDrag(null);
    },
    [doLaunch]
  );

  const toggleDebug = useCallback(async () => {
    const next = !unlimited;
    await setDebugUnlimited(next);
    setUnlimited(next);
    const s = await getThrowState();
    setRemaining(s.remaining);
  }, [unlimited]);

  // 見かけの伸び（張力カーブ）
  const stretch = useMemo(() => {
    if (!drag) return { x: 0, y: 0, mag: 0 };
    return tension(drag.x, drag.y);
  }, [drag]);

  const ballPos = useMemo(
    () => ({ x: launchPoint.x + stretch.x, y: launchPoint.y + stretch.y }),
    [launchPoint, stretch]
  );

  const def = getEmotion(selected);
  const bandWidth = Math.max(1.5, 7 - stretch.mag / 26);

  const ufoTranslate = ufoX.interpolate({
    inputRange: [0, 1],
    outputRange: [-UFO_OFF - UFO_SIZE / 2, area.w + UFO_OFF - UFO_SIZE / 2],
  });

  return (
    <View style={styles.screen}>
      <Header remaining={remaining} debugUnlimited={unlimited} onToggleDebug={toggleDebug} />

      {/* 上部: 感情ピッカー＋ひとことメモ */}
      <View style={styles.picker}>
        <EmotionPicker selected={selected} onSelect={setSelected} memo={memo} onChangeMemo={setMemo} />
      </View>

      {/* スロー領域（UFO・スリンガー・飛行） */}
      <View style={[styles.throwZone, { height: THROW_H }]} onLayout={onZoneLayout}>
        {area.w > 0 && ufoVisible && (
          <Animated.View
            style={[styles.target, { top: area.h * UFO_Y - UFO_SIZE * 0.35, width: UFO_SIZE, transform: [{ translateX: ufoTranslate }] }]}
            pointerEvents="none"
          >
            {target.kind === 'ufo' ? <Ufo size={UFO_SIZE} active={targetActive} /> : <BasketHoop size={UFO_SIZE} active={targetActive} />}
          </Animated.View>
        )}

        {/* 飛行中ボール */}
        {balls.map((b) => (
          <EmotionBall
            key={b.bodyId}
            emotion={b.emotion}
            variation={b.variation}
            size={b.size}
            style={{ position: 'absolute', left: b.x - b.size / 2, top: b.y - b.size / 2, transform: [{ rotate: `${b.angle}rad` }] }}
          />
        ))}

        {/* 命中の花火 */}
        {burst && <Fireworks key={burst.key} x={burst.x} y={burst.y} onDone={() => setBurst(null)} />}

        {/* スリンガーの張力帯（発射点→ボール） */}
        {drag && area.w > 0 && (
          <Svg width={area.w} height={area.h} style={styles.overlay} pointerEvents="none">
            <Line x1={launchPoint.x - 13} y1={launchPoint.y} x2={ballPos.x} y2={ballPos.y} stroke={def.color} strokeWidth={bandWidth} strokeLinecap="round" opacity={0.55} />
            <Line x1={launchPoint.x + 13} y1={launchPoint.y} x2={ballPos.x} y2={ballPos.y} stroke={def.color} strokeWidth={bandWidth} strokeLinecap="round" opacity={0.55} />
          </Svg>
        )}

        {/* 予測軌道 */}
        {drag && area.w > 0 && (
          <TrajectoryLine width={area.w} height={area.h} from={launchPoint} pull={{ x: stretch.x, y: stretch.y }} color={def.color} />
        )}

        {/* 操作ヒント */}
        {!drag && (
          <View style={styles.hint} pointerEvents="none">
            <Svg width={18} height={12} viewBox="0 0 18 12">
              <Path d="M3 9 L9 3 L15 9" stroke={text.faint} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.hintText}>引いて離す（スリンガー）</Text>
          </View>
        )}

        {/* 待機ボール（スリンガーの起点） */}
        {area.w > 0 && (
          <PanGestureHandler onGestureEvent={onGesture} onHandlerStateChange={onPanState}>
            <View style={[styles.ready, { left: ballPos.x - BALL / 2, top: ballPos.y - BALL / 2, width: BALL, height: BALL }]}>
              <EmotionBall emotion={selected} variation={0} size={BALL} shadow />
            </View>
          </PanGestureHandler>
        )}
      </View>

      {/* 単一のデンスパイル（今日分＋過去分を一体で・上から密に） */}
      <ScrollView style={styles.pile} contentContainerStyle={styles.pileContent} showsVerticalScrollIndicator={false}>
        <ArchiveScreen entries={entries} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: bg.base,
    paddingTop: 8,
  },
  overlay: { position: 'absolute', left: 0, top: 0 },
  throwZone: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: bg.base,
  },
  target: { position: 'absolute', left: 0, alignItems: 'center' },
  ready: { position: 'absolute' },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 14,
    alignItems: 'center',
    gap: 4,
  },
  hintText: { fontSize: 12, color: text.faint, letterSpacing: 1 },
  pile: { flex: 1, backgroundColor: bg.sunk },
  pileContent: { paddingBottom: 24 },
  picker: {
    backgroundColor: bg.base,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: bg.line,
  },
});

export default AddScreen;
