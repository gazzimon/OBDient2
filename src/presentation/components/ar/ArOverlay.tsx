// Paints the AR scene (route ribbon + maneuver marker) over the camera frame.
// All geometry comes from domain/ar; this component only draws.

import { useMemo } from 'react';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { buildOverlay } from '@/domain/ar/route-overlay';
import { horizonY, type CameraPose, type Intrinsics, type Pixel } from '@/domain/ar/camera-model';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

interface Props {
  width: number;
  height: number;
}

export function ArOverlay({ width, height }: Props) {
  const ego = useEgoStore((s) => s.ego);
  const pose = useEgoStore((s) => s.pose);
  const route = useNavStore((s) => s.route);
  const progress = useNavStore((s) => s.progress);
  const cal = useSettingsStore((s) => s.calibration);
  const debug = useSettingsStore((s) => s.debugOverlay);

  const intr: Intrinsics = useMemo(() => ({ width, height, hfovDeg: cal.hfovDeg }), [width, height, cal.hfovDeg]);

  const cameraPose: CameraPose | null =
    ego && pose && ego.headingValid
      ? {
          heightM: cal.cameraHeightM,
          yawDeg: ego.headingDeg + cal.yawOffsetDeg,
          pitchDeg: pose.pitchDeg + cal.pitchOffsetDeg,
          rollDeg: pose.rollDeg + cal.rollOffsetDeg,
        }
      : null;

  const scene = route && progress && ego && cameraPose ? buildOverlay(route, progress, ego.position, cameraPose, intr) : null;

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {debug && cameraPose && <HorizonLine pose={cameraPose} intr={intr} />}
      {scene && scene.ribbon.length > 2 && (
        <Polygon
          points={pts(scene.ribbon)}
          fill={COLORS.mint}
          fillOpacity={0.32}
          stroke={COLORS.mint}
          strokeOpacity={0.9}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      {scene && scene.centerline.length > 1 && (
        <Polyline
          points={pts(scene.centerline)}
          fill="none"
          stroke={COLORS.text}
          strokeOpacity={0.55}
          strokeWidth={2}
          strokeDasharray="10 14"
        />
      )}
      {scene?.maneuver && (
        <>
          <Line
            x1={scene.maneuver.base.x}
            y1={scene.maneuver.base.y}
            x2={scene.maneuver.top.x}
            y2={scene.maneuver.top.y}
            stroke={COLORS.amber}
            strokeWidth={3}
          />
          <Circle
            cx={scene.maneuver.top.x}
            cy={scene.maneuver.top.y}
            r={Math.max(6, Math.min(22, 400 / scene.maneuver.top.depthM))}
            fill={COLORS.amber}
            stroke={COLORS.bg}
            strokeWidth={2}
          />
        </>
      )}
    </Svg>
  );
}

// Where the app believes the horizon is. If it does not sit on the real
// horizon, pitch/roll calibration is off — the quickest check there is.
export function HorizonLine({ pose, intr }: { pose: CameraPose; intr: Intrinsics }) {
  const y = horizonY(pose, intr);
  const slope = Math.tan((pose.rollDeg * Math.PI) / 180);
  const half = intr.width / 2;
  return (
    <Line
      x1={0}
      y1={y - slope * half}
      x2={intr.width}
      y2={y + slope * half}
      stroke={COLORS.amber}
      strokeOpacity={0.8}
      strokeWidth={1.5}
      strokeDasharray="6 6"
    />
  );
}

function pts(p: readonly Pixel[]): string {
  return p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
}
