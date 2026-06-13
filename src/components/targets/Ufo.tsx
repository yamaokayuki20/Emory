import React from 'react';
import { Image } from 'react-native';

const SRC = require('../../../assets/targets/ufo.png');
const ASPECT = 689 / 1154; // 素材の高さ/幅

interface Props {
  size?: number; // 横幅
  active?: boolean; // ヒット中のハイライト
}

/** ユーザー素材のピクセルUFO（往復ターゲット）。 */
function Ufo({ size = 58, active = false }: Props) {
  return (
    <Image
      source={SRC}
      style={{ width: size, height: size * ASPECT, opacity: active ? 0.8 : 1 }}
      resizeMode="contain"
    />
  );
}

export default Ufo;
