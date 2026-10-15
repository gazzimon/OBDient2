import React from 'react';
import { CircularGauge } from './CircularGauge';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

const COLORS = { critical: '#F26D6D', warning: '#F5A623', normal: '#2DE1A5' };

interface VoltageGaugeProps {
  param: ObdParameter | undefined;
}

export function VoltageGauge({ param }: VoltageGaugeProps) {
  const value = param?.value ?? 12;
  const color =
    param?.alert?.severity === 'critical' ? COLORS.critical :
    param?.alert?.severity === 'warning'  ? COLORS.warning  :
    COLORS.normal;

  return (
    <CircularGauge
      value={value}
      min={9}
      max={16}
      unit="V"
      label="Batería"
      precision={1}
      color={color}
    />
  );
}
