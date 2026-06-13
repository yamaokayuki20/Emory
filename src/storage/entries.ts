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

export async function saveEntries(entries: EmotionEntry[]): Promise<void> {
  await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
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
