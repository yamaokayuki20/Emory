import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AddScreen from './src/screens/AddScreen';
import { useEntries } from './src/state/useEntries';
import { advanceDays, resetClock, todayLabel } from './src/state/clock';
import { bg, text } from './src/theme/colors';

export default function App() {
  const { entries, loading, add, clearAll } = useEntries();
  // 日付送り/全消去のたびに key を変えて AddScreen を作り直し、永続エントリから再シードする
  // （＝日跨ぎでデータが引き継がれ、過去日は境界線で閉じ、翌日は上に積み始める）。
  const [reseedKey, setReseedKey] = useState(0);
  const [dateLabel, setDateLabel] = useState(() => todayLabel());

  const onAdvanceDay = useCallback(async () => {
    await advanceDays(1);
    setDateLabel(todayLabel());
    setReseedKey((k) => k + 1);
  }, []);

  const onClearData = useCallback(async () => {
    await clearAll();
    await resetClock();
    setDateLabel(todayLabel());
    setReseedKey((k) => k + 1);
  }, [clearAll]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={styles.root} edges={['top']}>
          <StatusBar style="dark" />
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={text.secondary} />
            </View>
          ) : (
            <AddScreen
              key={reseedKey}
              entries={entries}
              onAdd={add}
              dateLabel={dateLabel}
              onAdvanceDay={onAdvanceDay}
              onClearData={onClearData}
            />
          )}
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: bg.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
