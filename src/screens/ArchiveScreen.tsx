import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import EmotionBall from '../components/EmotionBall';
import { packBalls } from '../layout/packBalls';
import { EmotionEntry } from '../storage/entries';
import { bg, text } from '../theme/colors';

interface Props {
  entries: EmotionEntry[];
}

/**
 * アーカイブ。
 * カード/グリッドではなく、画面いっぱいにボールが密に詰まった見た目。
 * 右側に小さな日付ピル、日付境界に薄い点線。
 */
function ArchiveScreen({ entries }: Props) {
  const [width, setWidth] = useState(0);

  const pack = useMemo(() => {
    if (width <= 0) return null;
    return packBalls(entries, { width, size: 46, paddingTop: 24, bandGap: 22, rowOverlap: 0.16 });
  }, [entries, width]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {pack && (
        <View style={{ height: pack.height }}>
          {/* 日付境界の点線 */}
          {pack.bands.map((band, i) =>
            i === 0 ? null : (
              <Svg
                key={`l-${band.key}`}
                width={width}
                height={2}
                style={{ position: 'absolute', left: 0, top: band.top }}
                pointerEvents="none"
              >
                <Line
                  x1={12}
                  y1={1}
                  x2={width - 12}
                  y2={1}
                  stroke={bg.dottedLine}
                  strokeWidth={1.2}
                  strokeDasharray="2 6"
                  strokeLinecap="round"
                />
              </Svg>
            )
          )}

          {/* ボール群 */}
          {pack.balls.map((b) => (
            <EmotionBall
              key={b.entry.id}
              emotion={b.entry.emotion}
              variation={b.entry.variation}
              size={b.size}
              style={{
                position: 'absolute',
                left: b.x - b.size / 2,
                top: b.y - b.size / 2,
              }}
            />
          ))}

          {/* 右側の日付ピル */}
          {pack.bands.map((band) => (
            <View key={`p-${band.key}`} style={[styles.pill, { top: band.centerY - 11 }]} pointerEvents="none">
              <Text style={styles.pillText}>{band.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: bg.sunk,
  },
  pill: {
    position: 'absolute',
    right: 8,
    backgroundColor: bg.raised,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 3,
    shadowColor: '#3A3326',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: text.secondary,
  },
});

export default ArchiveScreen;
