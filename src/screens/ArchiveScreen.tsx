import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import EmotionBall from '../components/EmotionBall';
import { packBalls } from '../layout/packBalls';
import { EmotionEntry } from '../storage/entries';
import { bg } from '../theme/colors';

interface Props {
  entries: EmotionEntry[];
}

/**
 * アーカイブ。
 * 日付で区切らず、画面いっぱいにボールが隙間なく密に積まれた見た目（ボールピット風）。
 * 新しい記録ほど上に積み上がる。
 */
function ArchiveScreen({ entries }: Props) {
  const [width, setWidth] = useState(0);

  const pack = useMemo(() => {
    if (width <= 0) return null;
    return packBalls(entries, { width, size: 46, paddingTop: 10 });
  }, [entries, width]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {pack && (
        <View style={{ height: pack.height }}>
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
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: bg.sunk,
  },
});

export default ArchiveScreen;
