import React from 'react';
import { CircularGauge } from './CircularGauge';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

const COLORS = { critical: '#F26D6D', warning: '#F5A623', normal: '#2DE1A5' };

interface RPMGaugeProps {
  param: ObdParameter | undefined;
}

export function RPMGauge({ param }: RPMGaugeProps) {
  const value = param?.value ?? 0;
  const color =
    param?.alert?.severity === 'critical' ? COLORS.critical :
    param?.alert?.severity === 'warning'  ? COLORS.warning  :
    COLORS.normal;

  return (
    <CircularGauge
      value={value}
      min={0}
      max={8000}
      unit="rpm"
      label="RPM"
      color={color}
    />
  );
}
