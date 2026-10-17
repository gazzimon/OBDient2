// Detector output drawn over the AR view: what the alerts are reasoning about.
// Deliberately quiet: only objects that matter get colour and a distance.

import { Fragment } from 'react';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { VRUS } from '@/domain/perception/detection';
import { COLORS } from '@/presentation/theme';
import { usePerceptionStore } from '@/store/perceptionStore';

const ALERT_FRESH_MS = 2500;

export function DetectionOverlay({ width, height }: { width: number; height: number }) {
  const objects = usePerceptionStore((s) => s.objects);
  const leadId = usePerceptionStore((s) => s.leadId);
  const lastAlert = usePerceptionStore((s) => s.lastAlert);
  const updatedAt = usePerceptionStore((s) => s.updatedAt);
  // Fresh relative to the latest detector frame, not the wall clock: render stays pure.
  const alerting = lastAlert != null && updatedAt - lastAlert.at < ALERT_FRESH_MS ? lastAlert : null;

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {objects.map((o) => {
        const isLead = o.trackId === leadId;
        const isVru = o.inPath && VRUS.has(o.cls);
        const critical = alerting?.trackId === o.trackId && alerting.level === 'critical';
        const color = critical ? COLORS.red : isLead || isVru ? COLORS.amber : COLORS.muted;
        const strong = isLead || isVru || critical;
        const x = o.box.x1 * width;
        const y = o.box.y1 * height;
        const w = (o.box.x2 - o.box.x1) * width;
        const h = (o.box.y2 - o.box.y1) * height;
        return (
          <Fragment key={o.trackId}>
            <Rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              fill="none"
              stroke={color}
              strokeOpacity={strong ? 0.95 : 0.4}
              strokeWidth={strong ? 2.5 : 1}
            />
            {strong && o.distance && (
              <SvgText
                x={x + w / 2}
                y={Math.max(12, y - 4)}
                fill={color}
                fontSize={13}
                fontWeight="bold"
                textAnchor="middle"
              >
                {`${Math.round(o.distance.forwardM)} m`}
              </SvgText>
            )}
          </Fragment>
        );
      })}
    </Svg>
  );
}
