import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { bg, text } from '../theme/colors';

interface Props {
  /** 残り投擲数（控えめに表示） */
  remaining?: number;
  /** デバッグ: 投擲制限の解除状態 */
  debugUnlimited?: boolean;
  onToggleDebug?: () => void;
  /** 現在のマイクロインタラクション表示＋切替 */
  microLabel?: string;
  onCycleMicro?: () => void;
  onPressCalendar?: () => void;
  onPressMenu?: () => void;
}

/**
 * 上部ヘッダー。
 * 左: シンプルな顔アイコン / 中央: アプリ名「エモリー」/ 右: カレンダー・メニュー
 * 残り投擲数は右肩に控えめなドットで表示。
 */
function Header({ remaining, debugUnlimited, onToggleDebug, microLabel, onCycleMicro, onPressCalendar, onPressMenu }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={styles.left}>
          <Svg width={22} height={22} viewBox="0 0 22 22">
            <Circle cx={11} cy={11} r={10} fill={bg.base} stroke={text.secondary} strokeWidth={1.4} />
            <Circle cx={7.5} cy={9.5} r={1.3} fill={text.primary} />
            <Circle cx={14.5} cy={9.5} r={1.3} fill={text.primary} />
            <Path d="M7 13.5 Q11 16 15 13.5" stroke={text.primary} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          </Svg>
          <Text style={styles.title}>エモリー</Text>
        </View>

        <View style={styles.right}>
          {onCycleMicro && (
            <Pressable hitSlop={8} onPress={onCycleMicro} style={styles.microBtn}>
              <Text style={styles.microTxt}>演出: {microLabel} ↻</Text>
            </Pressable>
          )}
          {onToggleDebug && (
            <Pressable
              hitSlop={8}
              onPress={onToggleDebug}
              style={[styles.debugBtn, debugUnlimited && styles.debugBtnOn]}
            >
              <Text style={[styles.debugTxt, debugUnlimited && styles.debugTxtOn]}>
                {debugUnlimited ? '∞ 解除中' : '制限解除'}
              </Text>
            </Pressable>
          )}
          {remaining !== undefined && !debugUnlimited && <ThrowDots remaining={remaining} />}
          <Pressable hitSlop={10} onPress={onPressCalendar} style={styles.iconBtn}>
            <Svg width={20} height={20} viewBox="0 0 20 20">
              <Rect x={2.5} y={3.5} width={15} height={14} rx={3} stroke={text.secondary} strokeWidth={1.5} fill="none" />
              <Line x1={2.5} y1={7.5} x2={17.5} y2={7.5} stroke={text.secondary} strokeWidth={1.5} />
              <Line x1={6.5} y1={2} x2={6.5} y2={5} stroke={text.secondary} strokeWidth={1.5} strokeLinecap="round" />
              <Line x1={13.5} y1={2} x2={13.5} y2={5} stroke={text.secondary} strokeWidth={1.5} strokeLinecap="round" />
            </Svg>
          </Pressable>
          <Pressable hitSlop={10} onPress={onPressMenu} style={styles.iconBtn}>
            <Svg width={20} height={20} viewBox="0 0 20 20">
              <Line x1={3} y1={6} x2={17} y2={6} stroke={text.secondary} strokeWidth={1.6} strokeLinecap="round" />
              <Line x1={3} y1={10} x2={17} y2={10} stroke={text.secondary} strokeWidth={1.6} strokeLinecap="round" />
              <Line x1={3} y1={14} x2={17} y2={14} stroke={text.secondary} strokeWidth={1.6} strokeLinecap="round" />
            </Svg>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ThrowDots({ remaining }: { remaining: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: 10 }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, { backgroundColor: i < remaining ? text.secondary : bg.line }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
  },
  bar: {
    height: 48,
    backgroundColor: bg.raised,
    borderRadius: 24,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#3A3326',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '600', color: text.primary, letterSpacing: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { padding: 2 },
  dots: { flexDirection: 'row', gap: 2, marginRight: 4, maxWidth: 60, flexWrap: 'wrap' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  debugBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: bg.line,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 2,
  },
  debugBtnOn: {
    backgroundColor: '#C57B57',
    borderColor: '#C57B57',
  },
  debugTxt: {
    fontSize: 10,
    fontWeight: '600',
    color: text.faint,
    letterSpacing: 0.5,
  },
  debugTxtOn: {
    color: '#FFFFFF',
  },
  microBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: bg.line,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 2,
  },
  microTxt: {
    fontSize: 10,
    fontWeight: '600',
    color: text.secondary,
    letterSpacing: 0.3,
  },
});

export default memo(Header);
