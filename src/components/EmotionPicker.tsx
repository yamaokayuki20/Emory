import React, { memo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { bg, text } from '../theme/colors';
import { EMOTION_LIST, EmotionKey } from '../theme/emotions';
import EmotionBall from './EmotionBall';

interface Props {
  selected: EmotionKey;
  onSelect: (key: EmotionKey) => void;
  memo: string;
  onChangeMemo: (v: string) => void;
}

/**
 * 下部の感情選択 UI。
 * 8感情を横スクロールで切り替え、任意で一言メモを添える。
 */
function EmotionPicker({ selected, onSelect, memo, onChangeMemo }: Props) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {EMOTION_LIST.map((e) => {
          const active = e.key === selected;
          return (
            <Pressable key={e.key} onPress={() => onSelect(e.key)} style={styles.item}>
              <View
                style={[
                  styles.ballWrap,
                  active && { backgroundColor: bg.raised, transform: [{ scale: 1.0 }] },
                  active && styles.activeRing,
                ]}
              >
                <EmotionBall emotion={e.key} variation={0} size={active ? 46 : 38} />
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {e.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <TextInput
        style={styles.memo}
        value={memo}
        onChangeText={onChangeMemo}
        placeholder="ひとことメモ（任意）"
        placeholderTextColor={text.faint}
        maxLength={60}
        returnKeyType="done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 8,
  },
  row: {
    paddingHorizontal: 12,
    gap: 4,
    alignItems: 'flex-end',
  },
  item: {
    width: 64,
    alignItems: 'center',
    paddingVertical: 4,
  },
  ballWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeRing: {
    borderWidth: 1.5,
    borderColor: bg.line,
  },
  label: {
    marginTop: 2,
    fontSize: 11,
    color: text.secondary,
  },
  labelActive: {
    color: text.primary,
    fontWeight: '600',
  },
  memo: {
    marginTop: 8,
    marginHorizontal: 16,
    height: 38,
    borderRadius: 19,
    backgroundColor: bg.raised,
    paddingHorizontal: 16,
    fontSize: 14,
    color: text.primary,
    borderWidth: 1,
    borderColor: bg.line,
  },
});

export default memo(EmotionPicker);
