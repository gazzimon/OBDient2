# OBDient2

Navegación con realidad aumentada para el auto. Eliges un destino, montas el teléfono en el
parabrisas y la ruta se dibuja **sobre la calle** en la imagen de la cámara, con instrucciones por
voz. Un adaptador OBD-II (opcional) aporta la velocidad real del vehículo y estabiliza la AR al frenar
y acelerar.

Sucesor de OBDient (repositorio hermano, app de diagnóstico): reutiliza su capa de adaptadores OBD (BLE, ELM327/STN), su sistema
visual y sus convenciones, con un producto nuevo encima.

## Estado

MVP en construcción, **solo Android**. Ver [docs/ROADMAP.md](docs/ROADMAP.md).

| Funciona (código + tests) | Pendiente de validar en dispositivo |
|---|---|
| Búsqueda de destino, cálculo de ruta, progreso, desvío y recálculo | Alineación AR real (calibración en auto) |
| Proyección AR de la ruta (modelo pinhole + recorte) | Signos de sensores en el teléfono de pruebas |
| Fusión GPS + IMU + OBD (posición, rumbo, cabeceo/alabeo) | Tasa real de velocidad con el Starcharm B33 |
| Telemetría OBD con detección STN y lectura rápida en CAN | Compilación nativa (EAS) |

## Cómo correrlo

Requiere un *development build*: la app usa módulos nativos (cámara, MapLibre, BLE) y no funciona en
Expo Go.

```bash
npm install
npx eas init                                # una vez: vincula el proyecto a tu cuenta EAS
npx eas build --profile development --platform android
npm start                                   # con el dev build instalado en el teléfono
```

Verificación local:

```bash
npm run typecheck && npm test && npm run lint
```

## Primer uso

1. **Vehículo** → *Buscar adaptador* → elegir el B33. Se reconecta solo en los siguientes arranques.
2. **Ajustes → Calibrar soporte**, con el teléfono ya montado y el auto detenido en una calle recta.
   Alinear el horizonte y el carril dibujados con los reales.
3. **Ruta** → buscar un destino (o mantener presionado el mapa) → *Iniciar AR*.

## Registro de viaje y reproducción

Con *Ajustes → Grabar registro técnico al navegar* (activado por defecto mientras se valida el MVP),
cada navegación guarda un archivo JSONL en el teléfono. Contiene GPS, IMU a 50 Hz, velocidad OBD,
estado fusionado, progreso de ruta y eventos. Unos 10 MB por hora, y nunca sale del teléfono por sí solo.

```bash
npm run trips:pull                         # copia los viajes del teléfono a ./trips/ (USB, build de desarrollo)
npm run replay -- trips/trip-XXXX.jsonl    # re-ejecuta la fusión y resume hallazgos
npm run replay -- trips/trip-XXXX.jsonl --sign -1   # ¿se arregla invirtiendo el sensor?
```

El análisis detecta, entre otras cosas, un **acelerómetro con el signo invertido**. Para eso compara la
aceleración medida a lo largo del eje de la cámara con la que se deriva de la velocidad: es la única
forma de verlo, porque una pose en reposo no lo delata.

## Estructura

```
src/
  domain/          lógica pura, sin React/Expo (testeada)
    geo/           geodesia de área pequeña (ENU)
    navigation/    ruta, progreso, guía por voz
    ar/            modelo de cámara y escena AR
    fusion/        estimadores de ego-estado, pose de cámara y signo del sensor
    recording/     formato del registro de viaje y su reproducción
    perception/    detección: seguimiento, distancia, TTC, escena y alertas (E4)
  data/            adaptadores: OBD (BLE/ELM/STN), sensores, OSRM, Photon
  presentation/    componentes, hooks, controlador de navegación
  store/           estado (zustand + MMKV)
  app/             pantallas (expo-router)
```

## Servicios y licencias

Mapas: OpenFreeMap / OpenMapTiles, datos © colaboradores de OpenStreetMap. Rutas: OSRM. Búsqueda:
Photon. Los servidores públicos por defecto **solo sirven para desarrollo**: para distribuir, ver
[ADR-0003](docs/ADR/0003-mapas-rutas-y-licencias.md).
