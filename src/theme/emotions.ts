import type { ImageSourcePropType } from 'react-native';

/**
 * 感情の定義。
 * 各感情は実素材の3D感情ボール画像（4バリエーション）を持つ。
 * color は UI アクセント / 軌道線 / フォールバック用に素材からサンプリングした代表色。
 */

export type EmotionKey =
  | 'happy'
  | 'excited'
  | 'calm'
  | 'relaxed'
  | 'tired'
  | 'sad'
  | 'anxious'
  | 'irritated';

export type EmotionGroup = 'positive' | 'neutral' | 'negative';

export interface EmotionDef {
  key: EmotionKey;
  label: string; // 日本語ラベル
  group: EmotionGroup;
  color: string; // 代表色（素材からサンプリング）
  variations: ImageSourcePropType[]; // 4種のボール画像
}

// React Native は静的 require が必須なため、明示的にマップする。
const balls: Record<EmotionKey, ImageSourcePropType[]> = {
  happy: [
    require('../../assets/balls/happy_0.png'),
    require('../../assets/balls/happy_1.png'),
    require('../../assets/balls/happy_2.png'),
    require('../../assets/balls/happy_3.png'),
  ],
  excited: [
    require('../../assets/balls/excited_0.png'),
    require('../../assets/balls/excited_1.png'),
    require('../../assets/balls/excited_2.png'),
    require('../../assets/balls/excited_3.png'),
  ],
  calm: [
    require('../../assets/balls/calm_0.png'),
    require('../../assets/balls/calm_1.png'),
    require('../../assets/balls/calm_2.png'),
    require('../../assets/balls/calm_3.png'),
  ],
  relaxed: [
    require('../../assets/balls/relaxed_0.png'),
    require('../../assets/balls/relaxed_1.png'),
    require('../../assets/balls/relaxed_2.png'),
    require('../../assets/balls/relaxed_3.png'),
  ],
  tired: [
    require('../../assets/balls/tired_0.png'),
    require('../../assets/balls/tired_1.png'),
    require('../../assets/balls/tired_2.png'),
    require('../../assets/balls/tired_3.png'),
  ],
  sad: [
    require('../../assets/balls/sad_0.png'),
    require('../../assets/balls/sad_1.png'),
    require('../../assets/balls/sad_2.png'),
    require('../../assets/balls/sad_3.png'),
  ],
  anxious: [
    require('../../assets/balls/anxious_0.png'),
    require('../../assets/balls/anxious_1.png'),
    require('../../assets/balls/anxious_2.png'),
    require('../../assets/balls/anxious_3.png'),
  ],
  irritated: [
    require('../../assets/balls/irritated_0.png'),
    require('../../assets/balls/irritated_1.png'),
    require('../../assets/balls/irritated_2.png'),
    require('../../assets/balls/irritated_3.png'),
  ],
};

export const EMOTIONS: Record<EmotionKey, EmotionDef> = {
  happy: { key: 'happy', label: 'うれしい', group: 'positive', color: '#D78D27', variations: balls.happy },
  excited: { key: 'excited', label: 'わくわく', group: 'positive', color: '#C86939', variations: balls.excited },
  calm: { key: 'calm', label: '落ち着く', group: 'neutral', color: '#E2D7C9', variations: balls.calm },
  relaxed: { key: 'relaxed', label: 'リラックス', group: 'neutral', color: '#DFD3C8', variations: balls.relaxed },
  tired: { key: 'tired', label: 'つかれた', group: 'negative', color: '#838E9B', variations: balls.tired },
  sad: { key: 'sad', label: '悲しい', group: 'negative', color: '#97A2AA', variations: balls.sad },
  anxious: { key: 'anxious', label: '不安', group: 'negative', color: '#909CAA', variations: balls.anxious },
  irritated: { key: 'irritated', label: 'イライラ', group: 'negative', color: '#9E9AA5', variations: balls.irritated },
};

// ピッカーでの表示順（ポジティブ→ニュートラル→ネガティブ）
export const EMOTION_ORDER: EmotionKey[] = [
  'happy',
  'excited',
  'calm',
  'relaxed',
  'tired',
  'sad',
  'anxious',
  'irritated',
];

export const EMOTION_LIST: EmotionDef[] = EMOTION_ORDER.map((k) => EMOTIONS[k]);

export function getEmotion(key: EmotionKey): EmotionDef {
  return EMOTIONS[key];
}

/** エントリ用に画像バリエーションを決定的に選ぶ（id をシードに） */
export function variationForId(id: string, key: EmotionKey): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % EMOTIONS[key].variations.length;
}

export function ballSource(key: EmotionKey, variation: number): ImageSourcePropType {
  const v = EMOTIONS[key].variations;
  return v[((variation % v.length) + v.length) % v.length];
}
