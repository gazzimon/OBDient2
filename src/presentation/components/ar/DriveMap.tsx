// Map shown while driving, either as the floating mini map over the AR view
// or full screen with the AR view floating. Same component in both roles, so
// swapping views only resizes it — nothing remounts, nothing reloads.
//
// androidView="texture": the camera preview is a surface too, and two
// overlapping SurfaceViews on Android may draw in the wrong order. A
// TextureView composes like any other view, above or below the camera.

import { useMemo } from 'react';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation } from '@maplibre/maplibre-react-native';
import { COLORS } from '@/presentation/theme';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

export function DriveMap({ primary }: { primary: boolean }) {
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);
  const route = useNavStore((s) => s.route);

  const shape = useMemo<GeoJSON.Feature | null>(
    () =>
      route
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.geometry.map((p) => [p.lng, p.lat]) },
          }
        : null,
    [route],
  );

  return (
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
      {/* Navigation view: follow the course, tilted when it has the room. */}
      <Camera trackUserLocation="course" zoom={primary ? 17 : 15.5} pitch={primary ? 50 : 0} />
      <NativeUserLocation mode="course" />
      {shape && (
        <GeoJSONSource id="drive-route" data={shape}>
          <Layer
            id="drive-route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': COLORS.bg, 'line-width': primary ? 11 : 7 }}
          />
          <Layer
            id="drive-route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': COLORS.mint, 'line-width': primary ? 7 : 4 }}
          />
        </GeoJSONSource>
      )}
    </Map>
  );
}
