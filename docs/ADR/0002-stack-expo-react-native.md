# ADR-0002 — Expo / React Native, reutilizando OBDient

**Estado:** aceptada · 2026-10-14

## Contexto

Se evaluaron Flutter, React Native, Kotlin Multiplatform y nativo puro. La premisa de que "el puente JS
añade latencia" está desactualizada: con JSI, los módulos nativos y los *frame processors* corren sin
serializar por un puente. En cualquier framework, el camino crítico de cámara e inferencia se escribe
en Kotlin/Swift. OBDient ya tiene una capa OBD probada en TypeScript (transporte BLE, ELM327/STN,
`ProtocolManager`) y un sistema visual propio.

## Decisión

- **Expo SDK 56 + React Native 0.85 + expo-router**, el mismo stack que OBDient. Development build,
  sin Expo Go.
- **Se copian de OBDient**, con sus tests: el transporte BLE y la detección GATT, `TransportCommandPort`,
  `ProtocolManager`, los parsers de PIDs, los perfiles de adaptador y los componentes visuales
  (paleta mint, IBM Plex Mono, pills, relojes).
- **No se copia** lo propio del diagnóstico: RAG, P2P, LLM local, garaje, Bluetooth clásico. El B33 es
  BLE, y BLE también funcionará en iOS cuando llegue.
- **Primera plataforma: Android** (minSdk 26). Adaptador de referencia: **Starcharm B33** (BLE, STN).
- Cámara: `expo-camera` para el MVP, que solo necesita la vista previa. Cuando llegue el detector (E4)
  se migra a `react-native-vision-camera` por sus *frame processors*. El cambio queda aislado en
  `CameraStage`.

## Consecuencias

- Reutilización inmediata de ~1000 líneas de código OBD probado.
- Los copiados divergen de OBDient a partir de aquí. Si se corrige un bug en uno, hay que portarlo
  a mano.
