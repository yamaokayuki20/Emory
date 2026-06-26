import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EmotionEntry,
  MAX_STORED_ENTRIES,
  clearEntries,
  loadEntries,
  makeId,
  saveEntries,
} from '../storage/entries';
import { EmotionKey, getEmotion, variationForId } from '../theme/emotions';
import { initClock, nowISO } from './clock';
import { clearPileCache } from '../layout/pileCache';
import { clearPositions } from './positions';

export interface UseEntries {
  entries: EmotionEntry[];
  loading: boolean;
  add: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
  reload: () => Promise<void>;
  /** デバッグ: 全データ消去（初回インストール状態に戻す）。 */
  clearAll: () => Promise<void>;
}

export function useEntries(): UseEntries {
  const [entries, setEntries] = useState<EmotionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // 永続化はデバウンス（投擲ごとに巨大JSONを同期保存しない＝メインスレッドを塞がない）。
  const latestRef = useRef<EmotionEntry[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveEntries(latestRef.current);
    }, 1200);
  }, []);

  const reload = useCallback(async () => {
    const loaded = await loadEntries();
    latestRef.current = loaded;
    setEntries(loaded);
  }, []);

  const clearAll = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    await clearEntries();
    await clearPileCache();
    await clearPositions();
    latestRef.current = [];
    setEntries([]);
  }, []);

  useEffect(() => {
    (async () => {
      await initClock();
      // 初回インストール時は空（絵文字層なし）。デモシードは入れない。
      const loaded = await loadEntries();
      latestRef.current = loaded;
      setEntries(loaded);
      setLoading(false);
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const add = useCallback(
    async (emotion: EmotionKey, memo?: string) => {
      const id = makeId();
      const entry: EmotionEntry = {
        id,
        emotion,
        variation: variationForId(id, emotion),
        color: getEmotion(emotion).color,
        memo: memo?.trim() ? memo.trim() : undefined,
        createdAt: nowISO(), // デバッグ時計（日付送り対応）
      };
      // メモリに追記（直近のみ保持）。保存はデバウンスで非同期に。
      setEntries((prev) => {
        const appended = [...prev, entry];
        const next =
          appended.length > MAX_STORED_ENTRIES ? appended.slice(appended.length - MAX_STORED_ENTRIES) : appended;
        latestRef.current = next;
        return next;
      });
      scheduleSave();
      return entry;
    },
    [scheduleSave]
  );

  return { entries, loading, add, reload, clearAll };
}
