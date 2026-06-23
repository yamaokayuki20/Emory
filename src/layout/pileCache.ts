import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EmotionEntry } from '../storage/entries';
import { BandedPile, BandOptions, computeDateBandedPile } from './dateBands';

/**
 * 【Phase 1】ベイク済み初期パイルの永続化。
 * 履歴の積み上がりは不変なので、`computeDateBandedPile` の結果（位置・境界）を一度だけ
 * 計算してストレージに保存し、次回以降は「位置を読むだけ」で復元する（物理 settle を回避）。
 * レイアウトに影響する入力（履歴・横幅・ボール径・アルゴリズム世代）が変わった時だけ再計算する。
 * ＝計算アルゴリズムや見た目は一切変えない、キャッシュ層のみの追加。
 */

const PILE_KEY = 'emory.pile';
// レイアウト計算の世代。dateBands のアルゴリズム/上限を変えたら上げて、古いキャッシュを無効化する。
// v2: 配置上限を 600→200 に戻した（600 は読み込みが固まり、settle 破綻で下層が重なるため）。
const LAYOUT_VERSION = 2;

interface CachedPile {
  sig: string;
  pile: BandedPile;
}

/** レイアウトに影響する入力だけから安定した署名を作る（並び順に依存しないよう整列）。 */
function signature(entries: EmotionEntry[], opts: BandOptions): string {
  const rows = entries.map((e) => `${e.id}:${e.emotion}:${e.variation}:${e.createdAt}`).sort();
  const s = `${opts.width}x${opts.ballSize}x${opts.groundY}|${rows.join(',')}`;
  let h = LAYOUT_VERSION >>> 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `v${LAYOUT_VERSION}-${entries.length}-${h.toString(36)}`;
}

/**
 * ベイク済みレイアウトを読む。署名が一致すれば物理 settle を行わず保存済みの位置を返す。
 * 一致しなければ計算し、保存してから返す（次回以降は即返し）。
 */
export async function loadOrComputeBandedPile(entries: EmotionEntry[], opts: BandOptions): Promise<BandedPile> {
  const sig = signature(entries, opts);
  const mark = (v: 'hit' | 'miss') => {
    // 自己テスト用フック（実害なし）。キャッシュ命中したかを確認する。
    if (typeof window !== 'undefined') (window as unknown as { __emoryPileCache?: string }).__emoryPileCache = v;
  };
  try {
    const raw = await AsyncStorage.getItem(PILE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as CachedPile;
      if (cached && cached.sig === sig && cached.pile && Array.isArray(cached.pile.placements)) {
        mark('hit');
        return cached.pile;
      }
    }
  } catch {
    // 読めない/壊れている → 計算にフォールバック
  }
  mark('miss');
  const pile = computeDateBandedPile(entries, opts);
  try {
    await AsyncStorage.setItem(PILE_KEY, JSON.stringify({ sig, pile } as CachedPile));
  } catch {
    // 保存失敗は致命的でない（次回も計算するだけ）
  }
  return pile;
}
