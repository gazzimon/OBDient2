// VisionCamera 5 Frame → the generic PixelSource the tensor code reads.
// Runs on the camera thread ('worklet').
//
// The frame output is requested as 'rgb'; depending on the phone that arrives
// as BGRA, RGBA or RGB(X). The byte layout is taken from the frame itself.

import type { Frame } from 'react-native-vision-camera';
import type { PixelSource } from '@/domain/perception/tensor';

export function pixelSourceFromFrame(frame: Frame): PixelSource | null {
  'worklet';
  if (!frame.hasPixelBuffer || frame.isPlanar) return null;
  const data = new Uint8Array(frame.getPixelBuffer());
  const bpp = Math.round(frame.bytesPerRow / frame.width);
  let r = 0;
  let g = 1;
  let b = 2;
  if (frame.pixelFormat === 'rgb-bgra-8-bit') {
    r = 2;
    b = 0;
  } else if (frame.pixelFormat !== 'rgb-rgba-8-bit' && frame.pixelFormat !== 'rgb-rgb-8-bit') {
    return null; // YUV or unknown: not requested, not supported
  }
  return {
    data,
    width: frame.width,
    height: frame.height,
    bytesPerRow: frame.bytesPerRow,
    rOffset: r,
    gOffset: g,
    bOffset: b,
    bytesPerPixel: bpp >= 4 ? 4 : 3,
    orientation: frame.orientation,
  };
}

// Horizontal field of view from the intrinsic matrix the camera delivers
// (3×3, row-major: fx at [0], cx at [2]). Null when not delivered.
// iOS only in VisionCamera 5 (Frame.cameraIntrinsicMatrix); on Android the
// FOV still comes from the AR calibration screen.
export function hfovFromIntrinsics(matrix: readonly number[] | undefined, width: number): number | null {
  'worklet';
  if (!matrix || matrix.length < 9) return null;
  const fx = matrix[0]!;
  if (!(fx > 0)) return null;
  return (2 * Math.atan(width / 2 / fx) * 180) / Math.PI;
}
