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
  TapGestureHandler,
  TapGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import EmotionPicker from '../components/EmotionPicker';
import Fireworks from '../components/Fireworks';
import Header from '../components/Header';
import { Ufo } from '../components/targets';
import BasketHoop, { BASKET_ASPECT, BASKET_HIT } from '../components/targets/BasketHoop';
import { useBoxPhysics, BoxBall } from '../physics/useBoxPhysics';
import type { DateBoundary } from '../layout/dateBands';
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
const BUILD = 'b53 history';

// 固定層の可視判定マージン
const CULL_MARGIN = BALL * 2;

/** y昇順配列から [top, bottom] のワールドy帯に入る連続スライスを返す（二分探索, O(log F + visible)）。 */
function visibleSlice(sorted: BoxBall[], top: number, bottom: number): BoxBall[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].y < top) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].y <= bottom) lo = mid + 1;
    else hi = mid;
  }
  return sorted.slice(start, lo);
}

// 投擲（タップ=自由落下 / フリック=投げる）
const FLICK_THRESHOLD = 240; // px/s 以上で「投げ」、未満は「タップ＝自由落下」
// 局所表面よりこの分だけ上でないと投擲ゾーンと見なさない（表面付近の取りこぼし／
// 層への誤生成を防ぐ余白）。山の上面ぴったりや内部はタップしても無反応＝掴む側。
const SPAWN_MARGIN = 18;
const FLICK_SCALE = 0.02;
const FLICK_MAX = 30;

// 画面内のレイアウト割合（箱はヘッダー直下のフル高さ。上部にピッカーを半透明オーバーレイ）
const UFO_FRAC = 0.18; // UFOの表示y（ピッカーの下）
// 山は基本固定。積み上がって上端がこの線より高くなった時だけ、ゆっくり「下げる」。
// 自動で上げる（せり上がる）挙動はしない。
const TOP_LIMIT_FRAC = 0.56; // 上端がこれより上に来たら下げ補正発動
const TARGET_FRAC = 0.74; // 山の上面の既定位置（画面のかなり下寄り＝投擲スペースを広く）

const UFO_SIZE = 58;
const UFO_OFF = 70;
const UFO_HIT_R = 34;
const PATROL_MS = 5200;
const RESPAWN_MS = 2200;

// 固定バスケットゴール（上部・シュート用）
const BASKET_W = 92;
// 右端ぴったり（left は area.w から算出）。少し下げて設置。
const BASKET_TOP_FRAC = 0.24;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * ボール群を「ワールド座標の絶対位置」で描画する層（memo）。
 * カメラ移動は親コンテナの translateY 一括変換で行うため、ここは cameraY に依存しない。
 * → スクロール（カメラ移動）では再描画されず、balls が変わった時だけ再描画される。
 */
/** 日付バンドの境界（点線ポリライン）＋日付ピルを描画（ワールド座標・memo化）。 */
const Boundaries = React.memo(function Boundaries({ boundaries, width }: { boundaries: DateBoundary[]; width: number }) {
  return (
    <>
      {boundaries.map((b) => {
        if (b.points.length < 2) return null;
        const ys = b.points.map((p) => p.y);
        const top = Math.min(...ys) - 4;
        const h = Math.max(...ys) - top + 8;
        const d = 'M ' + b.points.map((p) => `${p.x.toFixed(1)} ${(p.y - top).toFixed(1)}`).join(' L ');
        return (
          <React.Fragment key={b.dateKey}>
            <Svg width={width} height={h} style={{ position: 'absolute', left: 0, top }} pointerEvents="none">
              <Path d={d} stroke="rgba(70,58,44,0.8)" strokeWidth={2} strokeDasharray="1.5 7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <View style={[styles.datePill, { top: b.pillY - 11 }]} pointerEvents="none">
              <Text style={styles.datePillText}>{b.label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </>
  );
});

const BallsLayer = React.memo(function BallsLayer({ balls }: { balls: BoxBall[] }) {
  return (
    <>
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
    </>
  );
});

function AddScreen({ entries, onAdd }: Props) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<EmotionKey>('happy');
  const [remaining, setRemaining] = useState(10);
  const [unlimited, setUnlimited] = useState(false);
  // カメラ（ワールドyの表示上端）
  const [cameraY, setCameraY] = useState(0);
  const cameraYRef = useRef(0);
  cameraYRef.current = cameraY;
  const followRef = useRef(true);
  const camStartRef = useRef(0);
  // パン中の役割（上の空間＝投擲／絵文字層＝スクロール）を開始位置で確定。
  const panZoneRef = useRef<'throw' | 'scroll' | null>(null);
  const panMovedRef = useRef(false);
  // 指先に追従する「持っている」絵文字（投擲ゾーンでドラッグ中のみ）。
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null);

  // UFO
  const ufoX = useRef(new Animated.Value(0)).current;
  const [ufoVisible, setUfoVisible] = useState(true);
  const ufoVisibleRef = useRef(true);
  const [burst, setBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const respawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // スコア演出（バスケ命中）
  const [shootMsg, setShootMsg] = useState(false);
  const shootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // マイクロインタラクションは1回1つ（ランダム選択／上部ボタンで切替）
  const [micro, setMicro] = useState<'ufo' | 'basket'>(() => (Math.random() < 0.5 ? 'ufo' : 'basket'));
  const microRef = useRef(micro);
  microRef.current = micro;
  const cycleMicro = useCallback(() => setMicro((m) => (m === 'ufo' ? 'basket' : 'ufo')), []);

  const { balls, frozenSorted, frozenVersion, boundaries, restTopY, activeCount, groundY, drop, seed, setTarget, consumeHit, setGoal, consumeGoalHit, surfaceYAt } =
    useBoxPhysics({ width: area.w, ballSize: BALL });

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

  // カメラは山頂へ滑らかに追従（上方向のみ）。山は積むほど高くなり restTop は単調に
  // 小さくなる→カメラは上にだけ動く（せり上がる往復は起きない）。これで画面内の固定
  // ボールは「最新の1画面分」に頭打ちになり、描画コストが総数に依存しなくなる。
  useEffect(() => {
    let on = true;
    let raf = 0;
    const tick = () => {
      if (!on) return;
      if (followRef.current) {
        const a = areaRef.current;
        if (a.h > 0) {
          const tgt = restTopRef.current - a.h * TARGET_FRAC;
          setCameraY((prev) => {
            if (tgt >= prev - 0.4) return prev; // 下げ（上昇表示）方向には動かさない
            const next = prev + (tgt - prev) * 0.15;
            return Math.abs(next - prev) < 0.4 ? tgt : next;
          });
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

  // 固定バスケットの画面ジオメトリ（右端ぴったり・スコア判定位置）
  const basket = useMemo(() => {
    const w = BASKET_W;
    const h = BASKET_W * BASKET_ASPECT;
    const left = area.w - w; // 右端ぴったり
    const top = area.h * BASKET_TOP_FRAC;
    return { w, h, left, top, hitX: left + BASKET_HIT.fx * w, hitScreenY: top + BASKET_HIT.fy * h, r: BASKET_HIT.fr * w };
  }, [area.h, area.w]);
  const basketRef = useRef(basket);
  basketRef.current = basket;

  // UFO 位置に追従してターゲット（ワールド座標）を更新
  useEffect(() => {
    if (area.w <= 0) return;
    const id = ufoX.addListener(({ value }) => {
      const x = -UFO_OFF + value * (area.w + UFO_OFF * 2);
      const worldY = cameraYRef.current + area.h * UFO_FRAC;
      if (ufoVisibleRef.current && microRef.current === 'ufo') setTarget({ x, y: worldY, r: UFO_HIT_R });
      else setTarget(null);
    });
    return () => ufoX.removeListener(id);
  }, [area.w, area.h, setTarget, ufoX]);

  // 命中監視（hook からの立ち上がりを拾う）
  useEffect(() => {
    let on = true;
    let raf = 0;
    const tick = () => {
      if (!on) return;
      // 固定バスケのスコア判定円を毎フレーム更新（バスケ選択時のみ）
      const bk = basketRef.current;
      if (areaRef.current.w > 0 && microRef.current === 'basket') {
        setGoal({ x: bk.hitX, y: cameraYRef.current + bk.hitScreenY, r: bk.r });
      } else {
        setGoal(null);
      }
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
      // バスケ命中＝スコア演出
      const g = consumeGoalHit();
      if (g) {
        if (typeof window !== 'undefined') {
          const w = window as unknown as { __emoryGoals?: number };
          w.__emoryGoals = (w.__emoryGoals ?? 0) + 1;
        }
        setBurst({ key: Date.now() + 1, x: g.x, y: g.y - cameraYRef.current });
        setShootMsg(true);
        if (shootTimer.current) clearTimeout(shootTimer.current);
        shootTimer.current = setTimeout(() => setShootMsg(false), 1100);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      on = false;
      cancelAnimationFrame(raf);
      if (respawnTimer.current) clearTimeout(respawnTimer.current);
      if (shootTimer.current) clearTimeout(shootTimer.current);
    };
  }, [consumeHit, setTarget, setGoal, consumeGoalHit]);

  const onZoneLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  }, []);

  const doLaunch = useCallback(
    async (spawnX: number, spawnScreenY: number, vx: number, vy: number) => {
      const state = await consumeThrow();
      if (!state) {
        setRemaining(0);
        return;
      }
      setRemaining(state.remaining);
      const entry = await onAdd(selected);
      const worldY = cameraYRef.current + spawnScreenY;
      drop(selected, entry.variation, spawnX, worldY, vx, vy);
      followRef.current = true;
      // デバッグ用の投擲カウンタ（自己テストの計測に使用。実害なし）。
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __emoryThrows?: number };
        w.__emoryThrows = (w.__emoryThrows ?? 0) + 1;
      }
    },
    [selected, onAdd, drop]
  );

  // 指のx位置の「局所表面」の画面y。これ以上（下）＝絵文字層（掴む／生成しない）、
  // これより上＝空間（投擲）。山が凸凹でも列ごとの表面で正しく判定する。
  const surfaceScreenYAt = useCallback(
    (screenX: number) => surfaceYAt(screenX) - cameraYRef.current,
    [surfaceYAt]
  );

  // 自己テスト用フック（局所表面の画面y）。実害なし・軽量。
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __emorySurf?: (x: number) => number }).__emorySurf = surfaceScreenYAt;
    }
  }, [surfaceScreenYAt]);

  // タップ＝触れた場所にその場で自由落下（上の空間のみ／連続タップ対応：1タップ1個）。
  const onTap = useCallback(
    (e: TapGestureHandlerStateChangeEvent) => {
      if (e.nativeEvent.state !== State.ACTIVE) return;
      const { x, y } = e.nativeEvent;
      // 絵文字層の上面（少し余白）より下をタップ＝何もしない（層内への誤生成・すり抜け防止）。
      if (y >= surfaceScreenYAt(x) - SPAWN_MARGIN) return;
      const a = areaRef.current;
      void doLaunch(clamp(x, BALL / 2, a.w - BALL / 2), y, 0, 0);
    },
    [doLaunch, surfaceScreenYAt]
  );

  // パン中：投擲ゾーンなら絵文字を指先に追従、スクロールゾーンならカメラを動かす。
  const onPanGesture = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const { x, y, translationY } = e.nativeEvent;
      if (panZoneRef.current === 'scroll') {
        const { camMin, camMax } = camBounds();
        const next = clamp(camStartRef.current - translationY, camMin, camMax);
        cameraYRef.current = next;
        setCameraY(next);
      } else if (panZoneRef.current === 'throw') {
        panMovedRef.current = true;
        const a = areaRef.current;
        setHeld({ x: clamp(x, BALL / 2, a.w - BALL / 2), y });
      }
    },
    [camBounds]
  );

  // パン開始＝開始位置で役割確定。終了＝投擲（フリック/その場落下）orスクロール確定。
  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state: st, x, y, velocityX, velocityY } = e.nativeEvent;
      if (st === State.BEGAN) {
        panMovedRef.current = false;
        if (y < surfaceScreenYAt(x) - SPAWN_MARGIN) {
          // 上の空間＝投擲ゾーン（カメラは触らない）
          panZoneRef.current = 'throw';
        } else {
          // 絵文字層を掴む＝スクロールゾーン
          panZoneRef.current = 'scroll';
          followRef.current = false;
          camStartRef.current = cameraYRef.current;
        }
        return;
      }
      if (st !== State.END && st !== State.CANCELLED && st !== State.FAILED) return;
      const zone = panZoneRef.current;
      panZoneRef.current = null;
      if (zone === 'throw') {
        if (panMovedRef.current && st === State.END) {
          const a = areaRef.current;
          const sx = clamp(x, BALL / 2, a.w - BALL / 2);
          // 離した位置が層に埋まる場合は表面の少し上から発射（層内すり抜け防止）。
          const sy = Math.min(y, surfaceScreenYAt(sx) - BALL * 0.5);
          const speed = Math.hypot(velocityX, velocityY);
          if (speed > FLICK_THRESHOLD) {
            // フリック＝その方向へ投げる
            const vx = clamp(velocityX * FLICK_SCALE, -FLICK_MAX, FLICK_MAX);
            const vy = clamp(velocityY * FLICK_SCALE, -FLICK_MAX, FLICK_MAX);
            void doLaunch(sx, sy, vx, vy);
          } else {
            // ゆっくり離した＝その場に自由落下
            void doLaunch(sx, sy, 0, 0);
          }
        }
        setHeld(null);
      } else if (zone === 'scroll') {
        const { liveCam } = camBounds();
        if (cameraYRef.current <= liveCam + 40) followRef.current = true;
      }
    },
    [camBounds, doLaunch, surfaceScreenYAt]
  );

  const toggleDebug = useCallback(async () => {
    const next = !unlimited;
    await setDebugUnlimited(next);
    setUnlimited(next);
    const s = await getThrowState();
    setRemaining(s.remaining);
  }, [unlimited]);

  const ufoTranslate = ufoX.interpolate({
    inputRange: [0, 1],
    outputRange: [-UFO_OFF - UFO_SIZE / 2, area.w + UFO_OFF - UFO_SIZE / 2],
  });

  // 固定層は「画面内のスライス」だけ描画。カメラは20pxバケットに量子化して再計算を抑える。
  const CAM_BUCKET = 20;
  const camBucket = Math.round(cameraY / CAM_BUCKET);
  const frozenVisible = useMemo(() => {
    if (area.h <= 0 || frozenSorted.length === 0) return frozenSorted;
    const camTop = camBucket * CAM_BUCKET;
    return visibleSlice(frozenSorted, camTop - CULL_MARGIN, camTop + area.h + CULL_MARGIN);
    // frozenSorted は参照不変。変化は frozenVersion で検知する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozenVersion, camBucket, area.h]);

  return (
    <View style={styles.screen}>
      <Header
        remaining={remaining}
        debugUnlimited={unlimited}
        onToggleDebug={toggleDebug}
        microLabel={micro === 'ufo' ? 'UFO' : 'バスケ'}
        onCycleMicro={cycleMicro}
      />

      {/* 箱（ヘッダー直下のフル高さ。上に半透明ピッカーを重ねる） */}
      <View style={styles.box} onLayout={onZoneLayout}>
        {/* 入力キャッチャ（全面）。役割は「触れ始めた場所」で切り分け。
            上の空間＝タップで落下／持って動かすと指先追従→フリックで投げる。
            絵文字層を掴む＝ドラッグでスクロール（層が持ち上がる）。 */}
        <TapGestureHandler onHandlerStateChange={onTap} maxDeltaX={12} maxDeltaY={12}>
          <PanGestureHandler onGestureEvent={onPanGesture} onHandlerStateChange={onPanState}>
            <View style={StyleSheet.absoluteFill} />
          </PanGestureHandler>
        </TapGestureHandler>

        {/* 右側の薄いグラデーション背景（日付ピルを読みやすく） */}
        {area.w > 0 && (
          <Svg width={96} height={area.h} style={{ position: 'absolute', right: 0, top: 0 }} pointerEvents="none">
            <Defs>
              <LinearGradient id="rg" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#2A221A" stopOpacity={0} />
                <Stop offset="1" stopColor="#2A221A" stopOpacity={0.14} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={96} height={area.h} fill="url(#rg)" />
          </Svg>
        )}

        {/* カメラはこのコンテナの translateY 一括変換で表現（スクロールは1ノード更新のみ）。
            中のボールはワールド座標固定 → 固定層はカメラ移動で再描画されない。 */}
        <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: -cameraY }] }]} pointerEvents="none">
          {/* 固定層（位置不変・memo化。固定追加（=可視スライス変化）時だけ再描画） */}
          <BallsLayer balls={frozenVisible} />
          {/* 動的層（飛行中＋上層の眠り・毎フレーム） */}
          <BallsLayer balls={balls} />
          {/* 日付バンドの境界（点線）＋日付ピル */}
          {boundaries.length > 0 && <Boundaries boundaries={boundaries} width={area.w} />}
        </View>

        {/* 固定バスケットゴール（バスケ選択時のみ・右端ぴったり） */}
        {area.w > 0 && micro === 'basket' && (
          <View style={{ position: 'absolute', left: basket.left, top: basket.top }} pointerEvents="none">
            <BasketHoop width={basket.w} />
          </View>
        )}

        {/* UFO（UFO選択時のみ・飛行） */}
        {area.w > 0 && micro === 'ufo' && ufoVisible && (
          <Animated.View
            style={[styles.ufo, { top: area.h * UFO_FRAC - UFO_SIZE * 0.35, width: UFO_SIZE, transform: [{ translateX: ufoTranslate }] }]}
            pointerEvents="none"
          >
            <Ufo size={UFO_SIZE} active={false} />
          </Animated.View>
        )}

        {/* 花火 */}
        {burst && <Fireworks key={burst.key} x={burst.x} y={burst.y} onDone={() => setBurst(null)} />}

        {/* スコア演出 */}
        {shootMsg && (
          <View style={styles.shoot} pointerEvents="none">
            <Text style={styles.shootText}>ナイスシュート！</Text>
          </View>
        )}

        {/* 指先に追従する「持っている」絵文字（投擲ゾーンでドラッグ中） */}
        {held && (
          <View
            style={[styles.held, { left: held.x - BALL / 2, top: held.y - BALL / 2, width: BALL, height: BALL }]}
            pointerEvents="none"
          >
            <EmotionBall emotion={selected} variation={0} size={BALL} shadow />
          </View>
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
  shoot: { position: 'absolute', alignSelf: 'center', top: '20%' },
  shootText: { fontSize: 22, fontWeight: '800', color: '#C57B57', letterSpacing: 1 },
  datePill: { position: 'absolute', right: 8, backgroundColor: 'rgba(40,34,26,0.82)', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 3 },
  datePillText: { fontSize: 11, fontWeight: '700', color: '#FBF7EF' },
  held: { position: 'absolute' },
  build: { position: 'absolute', right: 6, bottom: 3, opacity: 0.6 },
  buildText: { fontSize: 9, color: text.faint },
});

export default AddScreen;
