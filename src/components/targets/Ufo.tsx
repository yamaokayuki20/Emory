import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

import { text } from '../../theme/colors';

interface Props {
  size?: number;
  active?: boolean; // ヒット中のハイライト
}

/** スペースインベーダー風のUFO。素材トーンに合わせたアースカラー。 */
function Ufo({ size = 96, active = false }: Props) {
  const w = size;
  const h = size * 0.62;
  return (
    <View style={styles.wrap}>
      <Svg width={w} height={h} viewBox="0 0 100 62">
        <Defs>
          <LinearGradient id="dome" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#C9D2D8" />
            <Stop offset="1" stopColor="#9AA6AE" />
          </LinearGradient>
          <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#B7AE9E" />
            <Stop offset="1" stopColor="#8C8473" />
          </LinearGradient>
        </Defs>
        {/* 吸い込みビーム */}
        {active && (
          <Path d="M38 40 L62 40 L74 62 L26 62 Z" fill="#E8D9B8" opacity={0.5} />
        )}
        {/* 本体 */}
        <Ellipse cx={50} cy={40} rx={44} ry={13} fill="url(#body)" />
        {/* ドーム */}
        <Path d="M28 38 Q50 8 72 38 Z" fill="url(#dome)" />
        <Ellipse cx={50} cy={38} rx={22} ry={6} fill="#7E8890" opacity={0.4} />
        {/* ライト */}
        <Ellipse cx={30} cy={42} rx={3} ry={3} fill={active ? '#E0B84E' : '#D9C7A0'} />
        <Ellipse cx={50} cy={45} rx={3} ry={3} fill={active ? '#E0B84E' : '#C9B98F'} />
        <Ellipse cx={70} cy={42} rx={3} ry={3} fill={active ? '#E0B84E' : '#D9C7A0'} />
      </Svg>
      <View style={[styles.shadow, { width: w * 0.5 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  shadow: {
    height: 6,
    borderRadius: 6,
    backgroundColor: text.faint,
    opacity: 0.18,
    marginTop: 2,
  },
});

export default Ufo;
