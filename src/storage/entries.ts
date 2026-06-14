import AsyncStorage from '@react-native-async-storage/async-storage';

import { EmotionKey } from '../theme/emotions';

const ENTRIES_KEY = 'emory.entries';

export interface EmotionEntry {
  id: string;
  emotion: EmotionKey;
  variation: number; // 使用したボール画像のバリエーション
  color: string;
  memo?: string;
  createdAt: string; // ISO日時
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadEntries(): Promise<EmotionEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(ENTRIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EmotionEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 保存件数の上限（直近のみ保持。巨大化と保存コストの増大を防ぐ）。
export const MAX_STORED_ENTRIES = 600;

export async function saveEntries(entries: EmotionEntry[]): Promise<void> {
  const capped = entries.length > MAX_STORED_ENTRIES ? entries.slice(-MAX_STORED_ENTRIES) : entries;
  await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(capped));
}

export async function addEntry(entry: EmotionEntry): Promise<EmotionEntry[]> {
  const entries = await loadEntries();
  const next = [...entries, entry];
  await saveEntries(next);
  return next;
}

export async function clearEntries(): Promise<void> {
  await AsyncStorage.removeItem(ENTRIES_KEY);
}
