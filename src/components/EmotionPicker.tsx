import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { bg, text } from '../theme/colors';
import { EMOTION_LIST, EmotionKey } from '../theme/emotions';
import EmotionBall from './EmotionBall';

interface Props {
  selected: EmotionKey;
  onSelect: (key: EmotionKey) => void;
}

/**
 * 上部の感情選択 UI。8感情を横スクロールで切り替える。
 * （背景は呼び出し側で半透明オーバーレイにして、奥を飛ぶ絵文字が透けて見えるようにする）
 */
function EmotionPicker({ selected, onSelect }: Props) {
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
              <View style={[styles.ballWrap, active && styles.activeRing]}>
                <EmotionBall emotion={e.key} variation={0} size={active ? 46 : 38} />
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {e.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
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
    backgroundColor: bg.raised,
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
});

export default memo(EmotionPicker);
