import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * アプリの「現在時刻」。デバッグで日付を進められるよう、実時刻に永続オフセットを足して扱う。
 * 起動時に initClock() でオフセットを読み込む。エントリの createdAt と「今日」の判定に使う。
 */

const KEY = 'emory.clockOffsetMs';
const DAY_MS = 86400000;
let offsetMs = 0;

export async function initClock(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    offsetMs = raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    offsetMs = 0;
  }
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function nowISO(): string {
  return new Date(nowMs()).toISOString();
}

export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 現在の「今日」キー（dateBands の dayKey と同形式）。 */
export function todayKey(): string {
  return dayKeyOf(new Date(nowMs()).toISOString());
}

/** デバッグ表示用ラベル（例: 6/25）。 */
export function todayLabel(): string {
  const d = new Date(nowMs());
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function advanceDays(n: number): Promise<void> {
  offsetMs += n * DAY_MS;
  try {
    await AsyncStorage.setItem(KEY, String(offsetMs));
  } catch {
    // 保存失敗は致命的でない
  }
}

export async function resetClock(): Promise<void> {
  offsetMs = 0;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
