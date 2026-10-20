// The car on the driving map, seen from behind and above. Drawn, not a 3D
// model: the camera follows the car, so a fixed picture looks the same and
// costs nothing.

import Svg, { Ellipse, Path, Rect } from 'react-native-svg';
import { COLORS } from '@/presentation/theme';

export const CAR_W = 44;
export const CAR_H = 64;

export function CarMarker() {
  return (
    <Svg width={CAR_W} height={CAR_H} viewBox="0 0 44 64">
      {/* shadow */}
      <Ellipse cx={22} cy={58} rx={19} ry={5} fill="#000" opacity={0.35} />
      {/* body: narrower ahead, as seen tilted */}
      <Path d="M10 6 Q22 0 34 6 L40 50 Q40 58 32 58 L12 58 Q4 58 4 50 Z" fill={COLORS.mint} stroke={COLORS.bg} strokeWidth={1.5} />
      {/* windscreen, roof, rear window */}
      <Path d="M12 12 Q22 8 32 12 L33 20 L11 20 Z" fill={COLORS.bg} opacity={0.75} />
      <Rect x={11} y={21} width={22} height={18} rx={4} fill={COLORS.mintDark} />
      <Path d="M10 40 L34 40 L35 47 L9 47 Z" fill={COLORS.bg} opacity={0.75} />
      {/* rear lights */}
      <Rect x={6} y={51} width={8} height={3} rx={1.5} fill="#FF4D4D" />
      <Rect x={30} y={51} width={8} height={3} rx={1.5} fill="#FF4D4D" />
    </Svg>
  );
}
