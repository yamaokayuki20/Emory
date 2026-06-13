import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { text } from '../theme/colors';

interface Props {
  width: number;
  height: number;
  // 発射点
  from: { x: number; y: number };
  // ドラッグ中の引っ張りベクトル（発射は逆方向）
  pull: { x: number; y: number };
  color?: string;
}

/**
 * スリングショットの予測軌道。引っ張り量に応じて放物線を点線で描く。
 */
function TrajectoryLine({ width, height, from, pull, color = text.secondary }: Props) {
  const power = Math.min(1.6, Math.hypot(pull.x, pull.y) / 120);
  if (power < 0.05) return null;
  // 発射速度 = 引っ張りの逆向き
  const vx = -pull.x * 0.16;
  const vy = -pull.y * 0.16;
  const g = 0.9;

  const pts: { x: number; y: number }[] = [];
  for (let t = 0; t < 26; t += 2) {
    const x = from.x + vx * t;
    const y = from.y + vy * t + 0.5 * g * t * t;
    if (y > height || x < 0 || x > width) break;
    pts.push({ x, y });
  }
  if (pts.length < 2) return null;

  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {pts.map((p, i) => (
        <Circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={Math.max(1.5, 4 - i * 0.12)}
          fill={color}
          opacity={Math.max(0.12, 0.7 - i * 0.05)}
        />
      ))}
    </Svg>
  );
}

export default TrajectoryLine;
