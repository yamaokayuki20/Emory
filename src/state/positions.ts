import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 各絵文字（entry.id）の実際の着地位置を永続保存する。
 * これにより、日付送りやアプリ再起動でも積んだ山を「並べたまま」復元できる（再レイアウトしない）。
 * 位置はワールド座標でボックス幅・ボール径に依存するため、幅/径が変わったら無効化して再計算に委ねる。
 */

const KEY = 'emory.positions.v1';

export interface Pos {
  x: number;
  y: number;
  a: number; // angle(rad)
}

interface Store {
  w: number;
  bs: number;
  map: Record<string, Pos>;
}

export async function loadPositions(width: number, ballSize: number): Promise<Record<string, Pos>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as Store;
    if (s && s.w === width && s.bs === ballSize && s.map) return s.map;
  } catch {
    // noop
  }
  return {};
}

export async function savePositions(width: number, ballSize: number, map: Record<string, Pos>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ w: width, bs: ballSize, map } as Store));
  } catch {
    // noop
  }
}

export async function clearPositions(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
