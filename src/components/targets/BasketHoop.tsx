import React from 'react';
import Svg, { Ellipse, Line, Path, Rect } from 'react-native-svg';

import { text } from '../../theme/colors';

interface Props {
  size?: number;
  active?: boolean;
}

/** バスケットゴール。右上に配置してシュートできる日替わりターゲット。 */
function BasketHoop({ size = 96, active = false }: Props) {
  return (
    <Svg width={size} height={size * 0.7} viewBox="0 0 100 70">
      {/* バックボード */}
      <Rect x={62} y={6} width={32} height={26} rx={3} fill="#EFE7D8" stroke={text.faint} strokeWidth={1.4} />
      <Rect x={72} y={14} width={12} height={10} rx={1.5} fill="none" stroke={text.secondary} strokeWidth={1.4} />
      {/* リング */}
      <Ellipse cx={56} cy={34} rx={14} ry={4} fill="none" stroke={active ? '#C57B57' : '#C2693E'} strokeWidth={3} />
      {/* ネット */}
      <Path d="M44 35 L49 52 M50 36 L52 54 M56 36 L56 55 M62 36 L60 54 M68 35 L63 52" stroke={text.faint} strokeWidth={1.2} fill="none" />
      <Line x1={49} y1={52} x2={63} y2={52} stroke={text.faint} strokeWidth={1.2} />
    </Svg>
  );
}

export default BasketHoop;
