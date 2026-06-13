/**
 * エモリーのカラーパレット
 * 方向性: Apple標準デザイン風 × 北欧 × アースカラー
 */

// 背景・UIトーン（温かいオフホワイト / グレージュ系）
export const bg = {
  base: '#F3ECE0', // うっすいベージュ
  raised: '#FBF7EF', // アイボリー（ヘッダー等）
  sunk: '#EAE1D2', // 少し沈んだベージュ（プール背景）
  line: '#D9CFBE', // 区切り線
  dottedLine: 'rgba(120, 108, 88, 0.35)', // 日付境界の薄い点線
} as const;

export const text = {
  primary: '#5A5142',
  secondary: '#8A8170',
  faint: '#B4AB99',
} as const;

/**
 * 感情ボールのアースカラー。
 * ビビッドにしすぎない、上品で少し彩度のある範囲。
 */
export const palette = {
  sandBeige: '#D9C2A3',
  mustard: '#D6A94E',
  terracotta: '#C57B57',
  sageGreen: '#A3B18A',
  dustyBlue: '#8FA8B8',
  warmGray: '#A89C8E',
  softLavender: '#B6A8C4',
  cream: '#E6D6B8',
  oliveGray: '#9A9676',
  dustyOrange: '#D89A6A',
} as const;

export type PaletteColor = (typeof palette)[keyof typeof palette];
