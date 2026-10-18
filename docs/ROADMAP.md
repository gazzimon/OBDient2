# Trayectoria

De una app de diagnóstico OBD (OBDient) a **navegación con realidad aumentada** en el auto. Cada etapa
entrega valor por sí sola y prepara la siguiente. Estado al 2026-10-18.

| Etapa | Qué entrega | Estado |
|---|---|---|
| **E0 Telemetría** | Conexión BLE con el adaptador Starcharm, detección STN, velocidad a la mayor tasa posible | ✅ B35 en banco: 24 Hz (2026-10-17) |
| **E1 Ego-estado** | Fusión GPS + IMU + OBD: posición suave, rumbo, aceleración, historia en marco ego | ✅ código · ⏳ campo |
| **E2 Navegación** | Destino por búsqueda o mapa, ruta, progreso, voz, desvío y recálculo | ✅ código · ⏳ campo |
| **E3 AR anclada** | Ruta dibujada sobre la calle, marcador de maniobra, calibración del soporte | ✅ código · ⏳ calibración real |
| **E4 Ver la vía** | Detector local para alertas: colisión frontal, distancia, "arrancó el de adelante", peatones | ✅ código · 🔧 en release el modelo no cargaba y los cuadros no se guardaban: corregido, ⏳ probar en el teléfono |
| **E5 Ayuda en servidor** | Z440: chat Qwen3.8-27B (GPU0), OSRM + Photon Argentina (CPU); luego maestro etiquetador y Qwen-Drive (GPU1) | ✅ rutas y búsqueda · ✅ banco de maestros (Waymo demo) · ⏳ con viajes propios |
| **E7 Asistente** | Chat por texto, voz e imágenes con herramientas OBD (ADR-0007), cuentas Firebase y gateway new-api (ADR-0008) | ✅ M0 gateway: `obdient.duckdns.org/llm/v1` (alias `obdient-chat`, primer token 0,2 s) · ⏳ M1 núcleo |
| **E6 Presentación** | Modo HUD reflejado en el parabrisas, otras plataformas (iOS) | pendiente |

**MVP = E0–E3**, solo Android.

## Criterios de salida del MVP

- La ruta dibujada coincide con el carril a 20 m con un error lateral visible menor que medio carril,
  en una calle recta, tras calibrar.
- Al frenar a fondo, la ruta no salta más que el ancho de una línea. Compensación OBD activa; se
  verifica con la opción *Datos técnicos sobre la AR*.
- Velocidad OBD ≥ 5 Hz sostenidos con el B33. La tasa se muestra en la pestaña Vehículo.
- Desvío detectado y ruta recalculada en ≤ 10 s, con conexión.
- Sin OBD, la app navega igual con GPS. Sin conexión, la ruta ya calculada sigue guiando.

## Decisión 2026-10-17

La prueba en la calle (calibración + primer viaje, criterios de AR) se **posterga** hasta que el
proyecto esté más avanzado: hoy aportaría poco. E0 queda validada en banco con el B35 (24 Hz) y el
Tablero probado en el auto. El registro de viaje y el `replay` siguen listos para cuando se haga.
Se avanza con **E4 (detector en el teléfono)**.

## Próximos pasos inmediatos

1. `eas init` + build de desarrollo e instalación en el teléfono de pruebas.
2. Banco con el B33 (Vehículo → Banco del adaptador): chip y firmware, Hz de velocidad por método y
   configuración de ahorro de energía. Ver [docs/hardware/adaptador-stn.md](hardware/adaptador-stn.md).
3. Calibración en auto: confirmar signos de sensores (`gravitySign`, lado landscape) y FOV.
4. Primer viaje real con el registro de viaje activado (por defecto), luego `npm run trips:pull` y
   `npm run replay` para revisar la fusión y la AR en la PC.

## Fuera del MVP, ya decidido

- **Servidor**: Qwen-Drive solo como ayuda opcional (ADR-0001). Su mejor uso inicial es el modo
  diferido (revisión de viajes, etiquetado), no la guía en vivo.
- **Detector**: Ultralytics YOLO nano destilado desde un maestro en la Z440; revisión de licencias diferida hasta antes de publicar (ADR-0005). Investigación en [research/deteccion-en-telefono.md](research/deteccion-en-telefono.md).
- **Rutas y teselas de producción**: OSRM + Photon autoalojados o un proveedor (ADR-0003).
