// Map shown while driving (Modo manejo): tilted 3D map (the style's
// buildings), the car fixed low on the screen, the map turning and moving
// under it, closer in town and farther on the road, and only the part of the
// route still ahead. In 2D, north up and the car turns. `primary` false is a
// small flat map that follows the GPS (kept for a future mini map).
//
// The full-screen camera follows the fused ego state (GPS + OBD + IMU) a few
// times a second with linear easing between updates — smoother than the raw
// GPS fix the native follow mode uses.
//

import { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type LngLat } from '@maplibre/maplibre-react-native';
import { CAR_AT, DRIVE_PITCH, carPadding, remainingPath, zoomForSpeed } from '@/domain/navigation/drive-camera';
import { CAR_H, CAR_W, CarMarker } from '@/presentation/components/drive/CarMarker';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

const FOLLOW_MS = 250;

interface Follow {
  center: LngLat;
  bearing: number;
  zoom: number;
}

// Samples the ego state every FOLLOW_MS; keeps the last good heading while stopped.
function useFollow(active: boolean): Follow | null {
  const [follow, setFollow] = useState<Follow | null>(null);
  useEffect(() => {
    if (!active) return;
    let bearing = 0;
    const id = setInterval(() => {
      const ego = useEgoStore.getState().ego;
      if (!ego) return;
      if (ego.headingValid) bearing = ego.headingDeg;
      setFollow({ center: [ego.position.lng, ego.position.lat], bearing, zoom: zoomForSpeed(ego.speedMps * 3.6) });
    }, FOLLOW_MS);
    return () => clearInterval(id);
  }, [active]);
  return follow;
}

export function DriveMap({ primary = true }: { primary?: boolean }) {
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);
  const route = useNavStore((s) => s.route);
  const progress = useNavStore((s) => s.progress);
  const map3d = useSettingsStore((s) => s.driveMap3d);
  const [height, setHeight] = useState(0);
  const follow = useFollow(primary);

  // Recomputed only when the car moves on to another segment.
  const segment = progress?.segmentIndex ?? -1;
  const shape = useMemo<GeoJSON.Feature | null>(() => {
    const coordinates = route ? remainingPath(route, primary ? progress : null) : [];
    return coordinates.length ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } : null;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, primary, segment],
  );

  const driving = primary && follow != null && height > 0;
  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      <Map
        style={{ flex: 1 }}
        androidView="texture"
        mapStyle={mapStyleUrl}
        logo={false}
        compass={false}
        attribution={primary}
        attributionPosition={{ bottom: 8, left: 8 }}
        // Navigation view, not a browsing map: a drag would end the follow
        // mode mid-drive. The mini map is a button (its parent handles taps).
        dragPan={false}
        touchZoom={false}
        touchRotate={false}
        touchPitch={false}
      >
        {driving ? (
          <Camera
            center={follow.center}
            // 2D: north up, the car turns instead of the map.
            bearing={map3d ? follow.bearing : 0}
            zoom={follow.zoom}
            pitch={map3d ? DRIVE_PITCH : 0}
            padding={{ top: map3d ? carPadding(height) : 0 }}
            duration={FOLLOW_MS}
            easing="linear"
          />
        ) : (
          <Camera trackUserLocation="course" zoom={primary ? 17 : 15.5} pitch={primary ? DRIVE_PITCH : 0} />
        )}
        {!driving && <NativeUserLocation mode="course" />}
        {shape && (
          <GeoJSONSource id="drive-route" data={shape}>
            <Layer
              id="drive-route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COLORS.bg, 'line-width': primary ? 16 : 7 }}
            />
            <Layer
              id="drive-route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COLORS.mint, 'line-width': primary ? 11 : 4 }}
            />
          </GeoJSONSource>
        )}
      </Map>
      {driving && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: '50%',
            marginLeft: -CAR_W / 2,
            top: height * (map3d ? CAR_AT : 0.5) - CAR_H * 0.55,
            transform: map3d ? [] : [{ rotate: `${follow.bearing}deg` }],
          }}
        >
          <CarMarker />
        </View>
      )}
    </View>
  );
}
