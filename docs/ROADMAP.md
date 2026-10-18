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

## Próximos pasos (2026-10-18)

### E7 · M2 — herramientas OBD reales (en curso)

Decisiones tomadas: códigos leídos **con encabezados** (`ATH1`, para saber qué módulo los tiene, con
~0,5 s de pausa de la telemetría); descripciones **en inglés** ahora (el modelo explica en español) y
traducidas para el modo sin conexión en M4; **histórico de fallas en el teléfono** (MMKV), con
sincronización cuando exista el login.

- [ ] **M2.0 Captura con el auto** (pendiente de una sesión en el auto): botón *Capturar diagnóstico*
  en Vehículo; `0101`, `0131`, `03`, `07`, `0A`, `0200`, `0202`, `0900`, `0902`, `ATDP`, con `ATH0` y
  `ATH1`; además prueba `STCSEGR 1`, `STVR 2`, `STDICES`, `STDITPO`, `STSLLT`, `STP 34`, y en ELM327
  `ATAMC`/`ATCTM1` (genuino o clon).
- [ ] **M2.1 Lectura de tramas**: respuestas en varios cuadros y varias ECUs, con y sin encabezados.
- [ ] **M2.2 Parsers**: códigos (`43`/`47`/`4A`), freeze frame, readiness con km desde el borrado (`0131`),
  VIN.
- [ ] **M2.3 Sesión**: todos los PIDs soportados, `query` y `exclusive`, muestreo, `STPX` con `r:`/`t:`
  en diagnóstico, `STVR`/`STPRS` cuando es STN.
- [ ] **M2.4 `VehicleToolAdapter`**: las 9 herramientas, error `rejected_by_car`.
- [ ] **M2.5 Histórico de fallas**: lecturas y borrados con fecha, códigos, freeze frame y km.
- [ ] **Adaptadores ELM327 sin STN (B14)**, ver [hardware/adaptador-elm327.md](hardware/adaptador-elm327.md):
  - [ ] esperar hasta 5 s ante `7F xx 78` (clones < v2.1 no lo hacen);
  - [ ] descartar bytes nulos (`0x00`) en el lector de respuestas;
  - [ ] reconocer `ERR94` y mandar `ATFE` antes de reintentar;
  - [ ] `ATWS` en lugar de `ATZ` (~800 ms menos por conexión y por recuperación);
  - [ ] energía: `AT LP` al desconectar o PP 0F configurado en fábrica (el ELM327 no se duerme solo).
- [ ] **Protocolo guardado por vehículo** (`ATSP A7` / `STP 34`): conexión sin búsqueda.

### Otros pendientes

- **Probar en el teléfono** (build Dev + Metro): detector YOLO y captura de cuadros, corregidos para
  builds release.
- **Banco de maestros con viajes propios**: un viaje con cuadros, `make_samples.py` y los tres modelos.
- **AR**: anclar el comienzo de la línea al auto (hoy queda corrida ~2 m por el eje de la calle y ~4°
  de rumbo).
- **Búsqueda de destinos**: priorizar resultados cercanos (Photon eligió un homónimo a 900 km).
- **new-api**: el límite de 10 pedidos por minuto es bajo para el asistente (2–4 llamadas por turno).
- **Calibración y primer viaje de AR** (postergados, ver *Decisión 2026-10-17*).

## Fuera del MVP, ya decidido

- **Servidor**: Qwen-Drive solo como ayuda opcional (ADR-0001). Su mejor uso inicial es el modo
  diferido (revisión de viajes, etiquetado), no la guía en vivo.
- **Detector**: Ultralytics YOLO nano destilado desde un maestro en la Z440; revisión de licencias diferida hasta antes de publicar (ADR-0005). Investigación en [research/deteccion-en-telefono.md](research/deteccion-en-telefono.md).
- **Rutas y teselas de producción**: OSRM + Photon autoalojados o un proveedor (ADR-0003).
