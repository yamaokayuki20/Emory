import React from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AddScreen from './src/screens/AddScreen';
import ArchiveScreen from './src/screens/ArchiveScreen';
import { useEntries } from './src/state/useEntries';
import { bg, text } from './src/theme/colors';

const { height: SCREEN_H } = Dimensions.get('window');

export default function App() {
  const { entries, loading, add } = useEntries();

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
            <ScrollView
              style={styles.root}
              showsVerticalScrollIndicator={false}
              decelerationRate="normal"
            >
              {/* 追加画面（1ページ目・ほぼ全画面） */}
              <View style={{ height: SCREEN_H - 60 }}>
                <AddScreen entries={entries} onAdd={add} />
              </View>
              {/* 下にスクロール → アーカイブ */}
              <ArchiveScreen entries={entries} />
            </ScrollView>
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
