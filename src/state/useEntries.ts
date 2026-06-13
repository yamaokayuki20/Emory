import { useCallback, useEffect, useState } from 'react';

import {
  EmotionEntry,
  addEntry as addEntryToStore,
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

  const reload = useCallback(async () => {
    const loaded = await loadEntries();
    setEntries(loaded);
  }, []);

  useEffect(() => {
    (async () => {
      const seeded = await seedIfEmpty();
      setEntries(seeded);
      setLoading(false);
    })();
  }, []);

  const add = useCallback(async (emotion: EmotionKey, memo?: string) => {
    const id = makeId();
    const entry: EmotionEntry = {
      id,
      emotion,
      variation: variationForId(id, emotion),
      color: getEmotion(emotion).color,
      memo: memo?.trim() ? memo.trim() : undefined,
      createdAt: new Date().toISOString(),
    };
    const next = await addEntryToStore(entry);
    setEntries(next);
    return entry;
  }, []);

  return { entries, loading, add, reload };

  // saveEntries は seed 経由で利用
  void saveEntries;
}
