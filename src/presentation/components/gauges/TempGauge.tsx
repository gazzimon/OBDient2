import React from 'react';
import { CircularGauge } from './CircularGauge';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

const COLORS = { critical: '#F26D6D', warning: '#F5A623', normal: '#2DE1A5' };

interface TempGaugeProps {
  param: ObdParameter | undefined;
}

export function TempGauge({ param }: TempGaugeProps) {
  const value = param?.value ?? 0;
  const color =
    param?.alert?.severity === 'critical' ? COLORS.critical :
    param?.alert?.severity === 'warning'  ? COLORS.warning  :
    COLORS.normal;

  return (
    <CircularGauge
      value={value}
      min={-40}
      max={130}
      unit="°C"
      label="Refrigerante"
      color={color}
    />
  );
}
