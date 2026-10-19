// Map shown while driving (Modo manejo). Full screen it is the driving view:
// tilted 3D map (the style's buildings), the car fixed low on the screen, the
// map turning and moving under it, closer in town and farther on the road,
// and only the part of the route still ahead. As the floating mini map (when
// the AR camera is the main view) it follows the GPS flat, as before. Same
// component in both roles, so swapping views only resizes it.
//
// The full-screen camera follows the fused ego state (GPS + OBD + IMU) a few
// times a second with linear easing between updates — smoother than the raw
// GPS fix the native follow mode uses.
//
// androidView="texture": the camera preview is a surface too, and two
// overlapping SurfaceViews on Android may draw in the wrong order. A
// TextureView composes like any other view, above or below the camera.

import { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type LngLat } from '@maplibre/maplibre-react-native';
import { CAR_AT, DRIVE_PITCH, carPadding, remainingPath, zoomForSpeed } from '@/domain/navigation/drive-camera';
import { CAR_H, CAR_W, CarMarker } from '@/presentation/components/ar/CarMarker';
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

export function DriveMap({ primary }: { primary: boolean }) {
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);
  const route = useNavStore((s) => s.route);
  const progress = useNavStore((s) => s.progress);
  const [height, setHeight] = useState(0);
  const follow = useFollow(primary);

  // Recomputed only when the car moves on to another segment.
  const segment = progress?.segmentIndex ?? -1;
  const shape = useMemo<GeoJSON.Feature | null>(
    () =>
      route
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: remainingPath(route, primary ? progress : null) },
          }
        : null,
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
            bearing={follow.bearing}
            zoom={follow.zoom}
            pitch={DRIVE_PITCH}
            padding={{ top: carPadding(height) }}
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
          style={{ position: 'absolute', left: '50%', marginLeft: -CAR_W / 2, top: height * CAR_AT - CAR_H * 0.55 }}
        >
          <CarMarker />
        </View>
      )}
    </View>
  );
}
