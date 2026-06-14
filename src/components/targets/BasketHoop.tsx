import React from 'react';
import { Image } from 'react-native';

const SRC = require('../../../assets/targets/basket.png');
export const BASKET_ASPECT = 309 / 320; // 高さ/幅
// ネットの口（スコア判定＝リング）の素材内相対位置と半径（幅比）。
// fr はリングの開口半径。ボールが中央を抜けられるよう開口を確保する。
export const BASKET_HIT = { fx: 0.3, fy: 0.32, fr: 0.32 };

interface Props {
  width?: number;
  active?: boolean;
}

/** ユーザー素材のバスケットゴール（固定設置・シュート用）。 */
function BasketHoop({ width = 132, active = false }: Props) {
  return (
    <Image
      source={SRC}
      style={{ width, height: width * BASKET_ASPECT, opacity: active ? 0.7 : 1 }}
      resizeMode="contain"
    />
  );
}

export default BasketHoop;
