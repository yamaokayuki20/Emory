import React from 'react';
import { Image, StyleSheet, View, ViewStyle } from 'react-native';

import { EmotionKey, ballSource } from '../theme/emotions';

interface Props {
  emotion: EmotionKey;
  variation?: number;
  size: number;
  /** やわらかい接地影を出すか（プール/アーカイブで密に並ぶときはオフ推奨） */
  shadow?: boolean;
  style?: ViewStyle;
}

/**
 * 実素材の3D感情ボールを表示する。
 * ボール自体に陰影が焼き込まれているので、必要に応じて控えめな接地影だけ足す。
 */
function EmotionBall({ emotion, variation = 0, size, shadow = false, style }: Props) {
  return (
    <View
      style={[
        { width: size, height: size },
        shadow && styles.shadow,
        style,
      ]}
    >
      <Image
        source={ballSource(emotion, variation)}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#3A3326',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});

export default React.memo(EmotionBall);
