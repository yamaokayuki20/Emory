import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import Svg, { Line, Path } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import EmotionPicker from '../components/EmotionPicker';
import Fireworks from '../components/Fireworks';
import Header from '../components/Header';
import TrajectoryLine from '../components/TrajectoryLine';
import { BasketHoop, Ufo, targetForToday } from '../components/targets';
import { useBoxPhysics } from '../physics/useBoxPhysics';
import { EmotionEntry } from '../storage/entries';
import { consumeThrow, getThrowState, isDebugUnlimited, setDebugUnlimited } from '../storage/rateLimit';
import { bg, text } from '../theme/colors';
import { EmotionKey, getEmotion } from '../theme/emotions';

interface Props {
  entries: EmotionEntry[];
  onAdd: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
}

const BALL = 46;
// ビルド識別（キャッシュ判別用。デプロイのたびに更新）
const BUILD = 'b22 settle';

// スリンガー
const STRETCH_MAX = 140;
const STRETCH_K = 78;
const STRETCH_TO_VEL = 0.14; // ×1.5
const VEL_MAX = 21;

// 画面内のレイアウト割合（箱はヘッダー直下のフル高さ。上部にピッカーを半透明オーバーレイ）
const UFO_FRAC = 0.18; // UFOの表示y（ピッカーの下）
const READY_FRAC = 0.42; // 待機ボールの表示y
// 山は基本動かさない。上端がこの帯[TOP..BOTTOM]の外に出たら、TARGET位置へ戻す。
// （積み上がりすぎ＝上に出る／落ち切って画面外＝下に出る、の両方を補正）
const TOP_LIMIT_FRAC = 0.34;
const BOTTOM_LIMIT_FRAC = 0.72;
const TARGET_FRAC = 0.5;

const UFO_SIZE = 58;
const UFO_OFF = 70;
const PATROL_MS = 5200;
const RESPAWN_MS = 2200;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function tension(dx: number, dy: number) {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.001) return { x: 0, y: 0, mag: 0 };
  const t = STRETCH_MAX * (1 - Math.exp(-mag / STRETCH_K));
  return { x: (dx / mag) * t, y: (dy / mag) * t, mag: t };
}

function AddScreen({ entries, onAdd }: Props) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<EmotionKey>('happy');
  const [remaining, setRemaining] = useState(10);
  const [unlimited, setUnlimited] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  // 投擲直後は次のボールを少し遅らせて出す（飛翔が見えるように）
  const [readyVisible, setReadyVisible] = useState(true);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // カメラ（ワールドyの表示上端）
  const [cameraY, setCameraY] = useState(0);
  const cameraYRef = useRef(0);
  cameraYRef.current = cameraY;
  const followRef = useRef(true);
  const camStartRef = useRef(0);

  // UFO
  const ufoX = useRef(new Animated.Value(0)).current;
  const [ufoVisible, setUfoVisible] = useState(true);
  const ufoVisibleRef = useRef(true);
  const [burst, setBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const respawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = useMemo(() => targetForToday(), []);

  const { balls, restTopY, activeCount, groundY, drop, seed, setTarget, consumeHit } = useBoxPhysics({
    width: area.w,
    ballSize: BALL,
  });

  // 最新値を ref に同期（コールバック/ループ用）
  const areaRef = useRef(area);
  areaRef.current = area;
  const restTopRef = useRef(restTopY);
  restTopRef.current = restTopY;

  // 手動スクロールの範囲（上端＝ライブ表示、下端＝箱の底）
  const camBounds = useCallback(() => {
    const a = areaRef.current;
    const liveCam = restTopRef.current - a.h * TARGET_FRAC;
    const camMin = liveCam - a.h * 0.15; // 少しだけ上も覗ける
    const camMax = Math.max(liveCam, groundY - a.h * 0.8); // 下スクロールで底
    return { liveCam, camMin, camMax };
  }, [groundY]);

  // 残数・デバッグ
  useEffect(() => {
    getThrowState().then((s) => setRemaining(s.remaining));
    isDebugUnlimited().then(setUnlimited);
  }, []);

  // 初期シード＋カメラ初期位置
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && area.w > 0 && area.h > 0 && entries.length > 0) {
      seededRef.current = true;
      seed(entries);
    }
  }, [area.w, area.h, entries, seed]);

  // 山が分かったら初回だけカメラを合わせる（上端を TARGET_FRAC に＝即フレーミング）
  const camInitRef = useRef(false);
  useEffect(() => {
    if (!camInitRef.current && area.h > 0 && restTopY < groundY) {
      camInitRef.current = true;
      const c = restTopY - area.h * TARGET_FRAC;
      cameraYRef.current = c;
      setCameraY(c);
    }
  }, [restTopY, area.h, groundY]);

  // カメラの帯補正：山の上端が帯[TOP..BOTTOM]の外に出たら TARGET へ戻す（ヒステリシス）。
  // 上に出る＝積み上がりすぎ、下に出る＝落ち切って画面外、の両方を補正＝常に画面内に収める。
  const correctingRef = useRef(false);
  useEffect(() => {
    let on = true;
    let raf = 0;
    const tick = () => {
      if (!on) return;
      if (followRef.current) {
        const a = areaRef.current;
        if (a.h > 0) {
          const restScreenY = restTopRef.current - cameraYRef.current;
          if (restScreenY < a.h * TOP_LIMIT_FRAC || restScreenY > a.h * BOTTOM_LIMIT_FRAC) {
            correctingRef.current = true;
          }
          if (correctingRef.current) {
            const tgt = restTopRef.current - a.h * TARGET_FRAC;
            setCameraY((prev) => {
              const next = prev + (tgt - prev) * 0.12;
              if (Math.abs(next - prev) < 0.4) {
                correctingRef.current = false;
                return tgt;
              }
              return next;
            });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      on = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // UFO 往復
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
  }, [area.w, ufoX]);

  // UFO 位置に追従してターゲット（ワールド座標）を更新
  useEffect(() => {
    if (area.w <= 0) return;
    const id = ufoX.addListener(({ value }) => {
      const x = -UFO_OFF + value * (area.w + UFO_OFF * 2);
      const worldY = cameraYRef.current + area.h * UFO_FRAC;
      if (ufoVisibleRef.current) setTarget({ x, y: worldY, r: target.hitRadius });
      else setTarget(null);
    });
    return () => ufoX.removeListener(id);
  }, [area.w, area.h, target.hitRadius, setTarget, ufoX]);

  // 命中監視（hook からの立ち上がりを拾う）
  useEffect(() => {
    let on = true;
    let raf = 0;
    const tick = () => {
      if (!on) return;
      const h = consumeHit();
      if (h && ufoVisibleRef.current) {
        setBurst({ key: Date.now(), x: h.x, y: h.y - cameraYRef.current });
        ufoVisibleRef.current = false;
        setUfoVisible(false);
        setTarget(null);
        if (respawnTimer.current) clearTimeout(respawnTimer.current);
        respawnTimer.current = setTimeout(() => {
          ufoVisibleRef.current = true;
          setUfoVisible(true);
        }, RESPAWN_MS);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      on = false;
      cancelAnimationFrame(raf);
      if (respawnTimer.current) clearTimeout(respawnTimer.current);
    };
  }, [consumeHit, setTarget]);

  const onZoneLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  }, []);

  useEffect(() => () => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
  }, []);

  // スリンガー
  const onSlingerGesture = useCallback((e: PanGestureHandlerGestureEvent) => {
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
      const entry = await onAdd(selected);
      const a = areaRef.current;
      const worldX = a.w / 2;
      const worldY = cameraYRef.current + a.h * READY_FRAC;
      drop(selected, entry.variation, worldX, worldY, vx, vy);
      followRef.current = true;
      // 飛翔が見えるよう、次の待機ボールは0.5s後に出す
      setReadyVisible(false);
      if (readyTimer.current) clearTimeout(readyTimer.current);
      readyTimer.current = setTimeout(() => setReadyVisible(true), 500);
    },
    [selected, onAdd, drop]
  );

  const onSlingerState = useCallback(
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

  // カメラの手動スクロール
  const onCamGesture = useCallback((e: PanGestureHandlerGestureEvent) => {
    const { camMin, camMax } = camBounds();
    const next = clamp(camStartRef.current - e.nativeEvent.translationY, camMin, camMax);
    cameraYRef.current = next;
    setCameraY(next);
  }, [camBounds]);

  const onCamState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const st = e.nativeEvent.state;
      if (st === State.BEGAN || st === State.ACTIVE) {
        followRef.current = false;
        camStartRef.current = cameraYRef.current;
      } else if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
        const { liveCam } = camBounds();
        if (cameraYRef.current <= liveCam + 40) followRef.current = true;
      }
    },
    [camBounds]
  );

  const toggleDebug = useCallback(async () => {
    const next = !unlimited;
    await setDebugUnlimited(next);
    setUnlimited(next);
    const s = await getThrowState();
    setRemaining(s.remaining);
  }, [unlimited]);

  const stretch = useMemo(() => (drag ? tension(drag.x, drag.y) : { x: 0, y: 0, mag: 0 }), [drag]);
  const def = getEmotion(selected);
  const bandWidth = Math.max(1.5, 7 - stretch.mag / 26);

  const readyScreen = { x: area.w / 2, y: area.h * READY_FRAC };
  const ballScreen = { x: readyScreen.x + stretch.x, y: readyScreen.y + stretch.y };

  const ufoTranslate = ufoX.interpolate({
    inputRange: [0, 1],
    outputRange: [-UFO_OFF - UFO_SIZE / 2, area.w + UFO_OFF - UFO_SIZE / 2],
  });

  // 画面外カリング
  const visible = useMemo(() => {
    const cy = cameraY;
    const h = area.h;
    return balls.filter((b) => {
      const sy = b.y - cy;
      return sy > -BALL && sy < h + BALL;
    });
  }, [balls, cameraY, area.h]);

  return (
    <View style={styles.screen}>
      <Header remaining={remaining} debugUnlimited={unlimited} onToggleDebug={toggleDebug} />

      {/* 箱（ヘッダー直下のフル高さ。上に半透明ピッカーを重ねる） */}
      <View style={styles.box} onLayout={onZoneLayout}>
        {/* 手動スクロール用の背景キャッチャ */}
        <PanGestureHandler onGestureEvent={onCamGesture} onHandlerStateChange={onCamState}>
          <View style={StyleSheet.absoluteFill} />
        </PanGestureHandler>

        {/* ボール（カリング済み・操作は透過） */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {visible.map((b) => (
            <EmotionBall
              key={b.bodyId}
              emotion={b.emotion}
              variation={b.variation}
              size={b.size}
              style={{
                position: 'absolute',
                left: b.x - b.size / 2,
                top: b.y - cameraY - b.size / 2,
                transform: [{ rotate: `${b.angle}rad` }],
              }}
            />
          ))}
        </View>

        {/* UFO */}
        {area.w > 0 && ufoVisible && (
          <Animated.View
            style={[styles.ufo, { top: area.h * UFO_FRAC - UFO_SIZE * 0.35, width: UFO_SIZE, transform: [{ translateX: ufoTranslate }] }]}
            pointerEvents="none"
          >
            {target.kind === 'ufo' ? <Ufo size={UFO_SIZE} active={false} /> : <BasketHoop size={UFO_SIZE} active={false} />}
          </Animated.View>
        )}

        {/* 花火 */}
        {burst && <Fireworks key={burst.key} x={burst.x} y={burst.y} onDone={() => setBurst(null)} />}

        {/* 張力帯＋予測軌道 */}
        {drag && area.w > 0 && (
          <>
            <Svg width={area.w} height={area.h} style={styles.overlay} pointerEvents="none">
              <Line x1={readyScreen.x - 13} y1={readyScreen.y} x2={ballScreen.x} y2={ballScreen.y} stroke={def.color} strokeWidth={bandWidth} strokeLinecap="round" opacity={0.55} />
              <Line x1={readyScreen.x + 13} y1={readyScreen.y} x2={ballScreen.x} y2={ballScreen.y} stroke={def.color} strokeWidth={bandWidth} strokeLinecap="round" opacity={0.55} />
            </Svg>
            <TrajectoryLine width={area.w} height={area.h} from={readyScreen} pull={{ x: stretch.x, y: stretch.y }} color={def.color} />
          </>
        )}

        {/* ヒント */}
        {!drag && readyVisible && (
          <View style={styles.hint} pointerEvents="none">
            <Svg width={18} height={12} viewBox="0 0 18 12">
              <Path d="M3 9 L9 3 L15 9" stroke={text.faint} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.hintText}>引いて離して箱に入れる</Text>
          </View>
        )}

        {/* 待機ボール（スリンガー）。投擲直後の0.5sは出さない */}
        {area.w > 0 && readyVisible && (
          <PanGestureHandler onGestureEvent={onSlingerGesture} onHandlerStateChange={onSlingerState}>
            <View style={[styles.ready, { left: ballScreen.x - BALL / 2, top: ballScreen.y - BALL / 2, width: BALL, height: BALL }]}>
              <EmotionBall emotion={selected} variation={0} size={BALL} shadow />
            </View>
          </PanGestureHandler>
        )}

        {/* 感情ピッカー（半透明オーバーレイ。奥を飛ぶ絵文字が透けて見える） */}
        <View style={styles.pickerOverlay} pointerEvents="box-none">
          <EmotionPicker selected={selected} onSelect={setSelected} />
        </View>

        {/* ビルド表示（キャッシュ判別用） */}
        <View style={styles.build} pointerEvents="none">
          <Text style={styles.buildText}>{BUILD}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.base, paddingTop: 8 },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: 'rgba(243,236,224,0.55)', // 半透明：奥の絵文字が透ける
  },
  box: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: bg.sunk },
  overlay: { position: 'absolute', left: 0, top: 0 },
  ufo: { position: 'absolute', left: 0, alignItems: 'center' },
  ready: { position: 'absolute' },
  hint: { position: 'absolute', alignSelf: 'center', top: '8%', alignItems: 'center', gap: 4 },
  hintText: { fontSize: 12, color: text.faint, letterSpacing: 1 },
  build: { position: 'absolute', right: 6, bottom: 3, opacity: 0.6 },
  buildText: { fontSize: 9, color: text.faint },
});

export default AddScreen;
