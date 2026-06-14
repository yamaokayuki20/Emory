import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EmotionEntry,
  MAX_STORED_ENTRIES,
  loadEntries,
  makeId,
  saveEntries,
} from '../storage/entries';
import { EmotionKey, getEmotion, variationForId } from '../theme/emotions';
import { seedIfEmpty } from './seed';

export interface UseEntries {
  entries: EmotionEntry[];
  loading: boolean;
  add: (emotion: EmotionKey, memo?: string) => Promise<EmotionEntry>;
  reload: () => Promise<void>;
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

  useEffect(() => {
    (async () => {
      const seeded = await seedIfEmpty();
      latestRef.current = seeded;
      setEntries(seeded);
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
        createdAt: new Date().toISOString(),
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

  return { entries, loading, add, reload };
}
