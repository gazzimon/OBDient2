import React from 'react';
import { CircularGauge } from './CircularGauge';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

interface SpeedGaugeProps {
  param: ObdParameter | undefined;
}

export function SpeedGauge({ param }: SpeedGaugeProps) {
  return (
    <CircularGauge
      value={param?.value ?? 0}
      min={0}
      max={250}
      unit="km/h"
      label="Velocidad"
    />
  );
}
