# ADR-0003 — Mapas, rutas y licencias para distribuir

**Estado:** aceptada · 2026-10-14

## Contexto

La app debe poder distribuirse (tiendas, uso comercial). Eso descarta dependencias GPL/AGPL en el
binario y servicios cuyos términos prohíben uso en producción.

## Decisión

| Pieza | Elección | Licencia / términos |
|---|---|---|
| Mapa | MapLibre React Native v11 | MIT |
| Teselas | OpenFreeMap (estilo *liberty*) | Gratuito, sin clave; atribución OSM/OpenMapTiles |
| Rutas | API OSRM v1 (puerto `RoutingPort`) | OSRM BSD-2; el **servidor demo público prohíbe producción** |
| Búsqueda | Photon (puerto `GeocodingPort`) | Apache-2.0; el **servidor público es de uso justo** |
| Detector (E4) | D-FINE / RT-DETR (Paddle) / YOLOX | Apache-2.0. **No Ultralytics** (AGPL-3.0) |

- Las URLs de rutas, búsqueda y estilo son configurables en Ajustes y persistentes. Por defecto
  apuntan a los servidores públicos **solo para desarrollo**.
- Para la primera versión distribuida: OSRM y Photon autoalojados (la Z440 alcanza con un extracto
  regional de OSM) o un proveedor comercial con la misma API.
- La atribución del mapa queda visible (botón de MapLibre) y se repite en Ajustes → Acerca de.

## Consecuencias

- Cambiar de proveedor es cambiar una URL o escribir un adaptador nuevo del mismo puerto.
- Pendiente antes de publicar: elegir el hosting de producción, revisar los términos de OpenFreeMap
  para el volumen esperado y revisar la licencia de cada dependencia nueva.
- El `package` de Android (`com.obdient.obdient2`) es provisional. Es permanente una vez publicado en
  Play Store: confirmarlo antes del primer upload.
