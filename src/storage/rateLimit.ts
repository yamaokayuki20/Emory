import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 投擲回数制限。
 * 仕様: 1回に投げられるのは最大10個。3時間ごとに回復。
 * 実装: 直近3時間以内の投擲タイムスタンプを保持し、10未満なら投擲可。
 * 3時間より古い投擲は枠が回復したとみなして除外する（スライディングウィンドウ）。
 */

const THROWS_KEY = 'emory.throws';
export const MAX_THROWS = 10;
export const WINDOW_MS = 3 * 60 * 60 * 1000; // 3時間

export interface ThrowState {
  remaining: number;
  /** 次に1枠回復するまでのミリ秒（満タンなら0） */
  recoverInMs: number;
}

async function loadStamps(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(THROWS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as number[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function prune(stamps: number[], now: number): number[] {
  return stamps.filter((t) => now - t < WINDOW_MS).sort((a, b) => a - b);
}

export async function getThrowState(now: number = Date.now()): Promise<ThrowState> {
  const stamps = prune(await loadStamps(), now);
  const remaining = Math.max(0, MAX_THROWS - stamps.length);
  let recoverInMs = 0;
  if (remaining < MAX_THROWS && stamps.length > 0) {
    recoverInMs = Math.max(0, stamps[0] + WINDOW_MS - now);
  }
  return { remaining, recoverInMs };
}

/** 1投を記録して新しい状態を返す。枠がなければ null。 */
export async function consumeThrow(now: number = Date.now()): Promise<ThrowState | null> {
  const stamps = prune(await loadStamps(), now);
  if (stamps.length >= MAX_THROWS) return null;
  stamps.push(now);
  await AsyncStorage.setItem(THROWS_KEY, JSON.stringify(stamps));
  return getThrowState(now);
}
