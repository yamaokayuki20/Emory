import {
  EmotionEntry,
  loadEntries,
  makeId,
  saveEntries,
} from '../storage/entries';
import { EMOTION_ORDER, EmotionKey, getEmotion, variationForId } from '../theme/emotions';

/**
 * 初回起動時のデモ用シード。
 * アーカイブが「ギチギチに詰まっている」見え方を確認できるよう、
 * 過去数日分の感情エントリを生成する。
 */
function pick<T>(arr: T[], r: number): T {
  return arr[Math.floor(r * arr.length) % arr.length];
}

// 日ごとに少し気分の偏りを持たせた重み付き感情列
const DAY_MOODS: EmotionKey[][] = [
  ['happy', 'excited', 'calm', 'relaxed', 'happy'],
  ['calm', 'relaxed', 'tired', 'calm', 'happy'],
  ['tired', 'sad', 'anxious', 'tired', 'irritated'],
  ['happy', 'calm', 'excited', 'relaxed', 'calm'],
  ['anxious', 'tired', 'sad', 'calm', 'relaxed'],
];

export function buildSeed(now: Date = new Date()): EmotionEntry[] {
  const entries: EmotionEntry[] = [];
  // 5日前〜今日まで
  for (let dayOffset = 5; dayOffset >= 1; dayOffset--) {
    const pool = DAY_MOODS[(dayOffset - 1) % DAY_MOODS.length];
    const count = 6 + ((dayOffset * 7) % 6); // 6〜11個
    for (let i = 0; i < count; i++) {
      const r = Math.abs(Math.sin((dayOffset + 1) * 12.9898 + i * 78.233)) % 1;
      const emotion = pick(pool.length ? pool : EMOTION_ORDER, r);
      const d = new Date(now);
      d.setDate(d.getDate() - dayOffset);
      d.setHours(9 + i, (i * 13) % 60, 0, 0);
      const id = makeId() + i;
      entries.push({
        id,
        emotion,
        variation: variationForId(id, emotion),
        color: getEmotion(emotion).color,
        createdAt: d.toISOString(),
      });
    }
  }
  return entries.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** ストアが空ならシードを投入。常に現在のエントリ配列を返す。 */
export async function seedIfEmpty(): Promise<EmotionEntry[]> {
  const existing = await loadEntries();
  if (existing.length > 0) return existing;
  const seed = buildSeed();
  await saveEntries(seed);
  return seed;
}
