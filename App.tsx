import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AddScreen from './src/screens/AddScreen';
import { useEntries } from './src/state/useEntries';
import { bg, text } from './src/theme/colors';

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
            <AddScreen entries={entries} onAdd={add} />
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
