import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

const USE_NATIVE = Platform.OS !== 'web';
const COLORS = ['#E0B84E', '#D78D27', '#C57B57', '#8FA8B8', '#A3B18A', '#FBF7EF', '#D89A6A'];

interface Props {
  x: number;
  y: number;
  onDone?: () => void;
}

/** ヒット時に弾ける花火エフェクト（放射状の粒＋中央フラッシュ）。 */
function Fireworks({ x, y, onDone }: Props) {
  const p = useRef(new Animated.Value(0)).current;
  const parts = useMemo(
    () =>
      Array.from({ length: 16 }).map((_, i) => {
        const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
        const dist = 46 + Math.random() * 46;
        return { angle, dist, size: 5 + Math.random() * 5, color: COLORS[i % COLORS.length] };
      }),
    []
  );

  useEffect(() => {
    Animated.timing(p, {
      toValue: 1,
      duration: 760,
      easing: Easing.out(Easing.quad),
      useNativeDriver: USE_NATIVE,
    }).start(() => onDone && onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const op = p.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 0.85, 0] });

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* 中央フラッシュ */}
      <Animated.View
        style={{
          position: 'absolute',
          left: x - 20,
          top: y - 20,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#FFF4D6',
          opacity: p.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.95, 0.5, 0] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.7] }) }],
        }}
      />
      {/* 放射粒 */}
      {parts.map((pt, i) => {
        const tx = p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(pt.angle) * pt.dist] });
        const ty = p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(pt.angle) * pt.dist + 16] });
        const sc = p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: x - pt.size / 2,
              top: y - pt.size / 2,
              width: pt.size,
              height: pt.size,
              borderRadius: pt.size / 2,
              backgroundColor: pt.color,
              opacity: op,
              transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }],
            }}
          />
        );
      })}
    </Animated.View>
  );
}

export default Fireworks;
