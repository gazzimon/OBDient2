// Base circular gauge — 270° arc driven by a Reanimated SharedValue.
// The progress arc animates on the UI thread; text re-renders at polling rate (~2 Hz).

import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface CircularGaugeProps {
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  // Number of decimal places for the center text (default 0)
  precision?: number;
  // Arc fill color — defaults to teal, caller changes to amber/red on alert
  color?: string;
  size?: number;
  strokeWidth?: number;
}

// QVAC mint accent
const TEAL = '#2DE1A5';
const TRACK_COLOR = '#2C2C2E';
// 180° semicircle (QVAC TDEE-style gauge): arc covers half the circumference
const SWEEP_RATIO = 0.5;
// Arc spans from 9 o'clock over the top to 3 o'clock → start at 180° in SVG coords
const START_ROTATION = 180;

export function CircularGauge({
  value,
  min,
  max,
  unit,
  label,
  precision = 0,
  color = TEAL,
  size = 160,
  strokeWidth = 12,
}: CircularGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = SWEEP_RATIO * circumference;
  const gapLength = circumference - arcLength;

  const progress = useSharedValue(0);

  useEffect(() => {
    const range = max - min;
    const clamped = range === 0 ? 0 : Math.min(Math.max((value - min) / range, 0), 1);
    progress.value = withTiming(isNaN(clamped) ? 0 : clamped, { duration: 400 });
  }, [value, min, max, progress]);

  const animatedProps = useAnimatedProps(() => ({
    // Offset from arcLength down to 0 as progress goes 0→1
    strokeDashoffset: arcLength * (1 - progress.value),
  }));

  const displayText = isNaN(value) ? '--' : value.toFixed(precision);

  // Semicircle: clip the empty bottom half of the SVG square
  const clippedHeight = size * 0.68;

  return (
    <View className="items-center">
      <View style={{ width: size, height: clippedHeight, overflow: 'hidden' }}>
        <Svg width={size} height={size}>
          {/* Background track — 180° arc */}
          <Circle
            cx={cx}
            cy={cx}
            r={radius}
            stroke={TRACK_COLOR}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={[arcLength, gapLength]}
            rotation={START_ROTATION}
            origin={`${cx},${cx}`}
          />
          {/* Progress arc */}
          <AnimatedCircle
            cx={cx}
            cy={cx}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={[arcLength, gapLength]}
            rotation={START_ROTATION}
            origin={`${cx},${cx}`}
            animatedProps={animatedProps}
          />
        </Svg>

        {/* Value + unit centered inside the semicircle */}
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: clippedHeight }}
          className="items-center justify-end"
        >
          <Text
            className="text-brand-text font-mono-bold"
            style={{ fontSize: size * 0.16 }}
          >
            {displayText}
          </Text>
          <Text className="text-brand-muted font-mono text-xs mt-0.5">{unit}</Text>
        </View>
      </View>

      <Text className="text-brand-muted font-mono text-xs mt-2">
        {label}
      </Text>
    </View>
  );
}
