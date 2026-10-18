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

### E7 · M2 — herramientas OBD reales (código completo; falta el auto)

Plan de M3 y flujo del agente: [plans/m3-chat-y-flujo-del-agente.md](plans/m3-chat-y-flujo-del-agente.md).

Decisiones tomadas: códigos leídos **con encabezados** (`ATH1`, para saber qué módulo los tiene, con
~0,5 s de pausa de la telemetría); descripciones **en inglés** ahora (el modelo explica en español) y
traducidas para el modo sin conexión en M4; **histórico de fallas en el teléfono** (MMKV), con
sincronización cuando exista el login.

- [ ] **M2.0 Captura con el auto**: ✅ botón *Capturar diagnóstico* en Vehículo (respuestas crudas,
  solo lectura, reconfigura al terminar) · ✅ B35 (2026-10-18, sin códigos; ver hardware/adaptador-stn.md) ·
  ⏳ B14, y un auto con códigos y freeze frame; `0101`, `0131`, `03`, `07`, `0A`, `0200`, `0202`, `0900`, `0902`, `ATDP`, con `ATH0` y
  `ATH1`; además prueba `STCSEGR 1`, `STVR 2`, `STDICES`, `STDITPO`, `STSLLT`, `STP 34`, y en ELM327
  `ATAMC`/`ATCTM1` (genuino o clon).
- [x] **M2.1 Lectura de tramas** (`core/utils/obdFrames.ts`): varios cuadros y varias ECUs, con y sin
  encabezados, CAN 11/29 bits y J1850/K-Line, espacios sí o no; probado con los ejemplos del datasheet
  ELM327. El lector de respuestas conserva una línea por cuadro. La captura muestra cómo armó cada
  respuesta (`= 7E8: …`) · ⏳ verificar en el auto · pendiente `STCSEGR 1` (el STN quita el PCI).
- [x] **M2.2 Parsers** (`core/utils/obdDiagnostics.ts`): códigos `03`/`07`/`0A` (con la cantidad
  inicial en CAN, tres por línea en J1850/K-Line, por ECU, rechazos aparte), genérico o de fabricante
  según J2012 §5; monitores (`0101`, nafta y diésel, por ECU y combinados); freeze frame con número de
  cuadro y las fórmulas en vivo; máscaras de PIDs soportados; VIN (CAN y J1850, dígito verificador
  informativo: el del auto del B35 no cierra, normal fuera de Norteamérica). Km desde el borrado: PID
  `DIST_SINCE_CLEAR` existente · ⏳ verificar con un auto con códigos y freeze frame.
- [ ] **M2.3 Sesión**: todos los PIDs soportados, `query` y `exclusive`, muestreo, `STPX` con `r:`/`t:`
  en diagnóstico, `STVR`/`STPRS` cuando es STN.
- [x] **M2.4 `VehicleToolAdapter`** (`data/obd/vehicle-tool-adapter.ts`, en `container.vehicleTools`):
  las 9 herramientas sobre los parsers de M2.2. Valores en vivo por el canal compartido; diagnóstico con
  `ATH1` en exclusiva (pausa ~0,5 s) y, en movimiento, sin encabezados ni pausa (ADR-0007 §5). Borrado
  (`04`) solo tras la confirmación, con los km previos. `rejected_by_car` con el motivo del `7F xx NN`
  (ISO 14229-1 A.1). Descripciones de códigos: interfaz `DtcDescriber`, vacía hasta el hito de base de
  conocimiento; el prompt no deja adivinar códigos de fabricante · ⏳ probar con el modelo y el auto.
  De M2.3 quedó hecho: `exclusive()`, todos los PIDs soportados. Falta: `STPX r:/t:` en diagnóstico,
  `STVR`/`STPRS`.
- [x] **M2.5 Histórico de fallas** (`domain/faults/fault-history.ts`, MMKV `obdient2-faults`,
  `container.faults`): por VIN, guarda cambios y no cada lectura (misma lista → "visto por última vez" y
  km); freeze frames distintos; cada borrado con los códigos previos y los km desde el borrado anterior;
  500 eventos. Lo alimenta `VehicleToolAdapter` · ⏳ mostrarlo (M3) y sincronizarlo con la cuenta
  (Firestore; ADR-0008 §5 revisado: el VIN sí va a Firebase).

### E7 · Cuentas (ADR-0008, antes de M3)

- [x] Servicio `server/auth` (K16, `127.0.0.1:8790`, Caddy `/auth`): valida el ID token de Firebase y
  devuelve la clave de new-api de la cuenta (un token por cuenta bajo el usuario `obdient2app`, solo
  `obdient-chat`, cuota propia); borra la clave al borrar la cuenta. Caché de 10 min por los límites
  de new-api. Tests con `node --test`.
- [x] Usuario `obdient2app` en new-api (`setup-app-user.py`) y `~/.config/obdient/auth.env`.
- [x] Panel de new-api: cuota de `obdient2app` y su token de acceso (`nap_…`, permisos de tokens).
- [x] Límite de pedidos de new-api: 120 respuestas/min (240 pedidos), compartido por todas las cuentas.
- [x] Proyecto de Firebase **`obdient2`** (CLI en la K16) con las apps `com.obdient.obdient2` y
  `com.obdient.obdient2.dev`, cada una con el SHA-1 y SHA-256 de su clave de EAS.
- [x] Login con Google activado (solo Google); `google-services.json` en el repo (las dos apps, cliente
  web de Google). `obdient-auth` corriendo (systemd --user) y publicado en
  `https://obdient.duckdns.org/auth` (2026-10-18): clave por cuenta probada contra el modelo (solo
  `obdient-chat`, otro modelo → 403), token inválido → 401.
- [x] App: login con Google (Credential Manager), Firebase por REST, clave del modelo en
  `expo-secure-store`; oferta en el primer arranque con "Ahora no"; Ajustes → Cuenta (cerrar sesión,
  borrar cuenta) · ⏳ probar en el teléfono con el build Dev nuevo (2026-10-18).
- [ ] Firestore: historial de fallas y VIN por cuenta.
- [ ] **Adaptadores ELM327 sin STN (B14)**, ver [hardware/adaptador-elm327.md](hardware/adaptador-elm327.md):
  - [x] esperar hasta 5 s ante `7F xx 78` y reenviar si el adaptador vuelve al prompt (clones < v2.1);
  - [x] descartar bytes nulos (`0x00`) en el lector de respuestas;
  - [x] `ERR94` se trata como reinicio del adaptador y la inicialización manda `ATFE`; otros `ERRxx`, sin dato;
  - [x] `ATWS` en lugar de `ATZ` (~800 ms menos), con `ATZ` de respaldo si no contesta (despertar o clon);
  - [x] energía: `ATLP` al cerrar la sesión si no es STN;
  - [ ] energía, para el producto: PP 0F (dormir sin actividad OBD) configurado en fábrica; medir consumo del B14 dormido.
- [ ] **Protocolo guardado por vehículo** (`ATSP A7` / `STP 34`): conexión sin búsqueda.

### E7 · Base de conocimiento y RAG (hito aparte, después de M2)

Parte de la estructura del agente: el modelo responde sobre códigos **solo con la base** y la cita;
sin entrada, se abstiene (medido: [research/verificacion-de-respuestas.md](research/verificacion-de-respuestas.md)).

- La rev. APR2002 con texto (repo `df2e6`, 2026-10-18) no suma códigos: sus 1.932 definidos están todos
  en la de 2007.
- **Fuente de códigos genéricos: SAE J2012** (PDF entregado por el usuario, no se versiona). La rev.
  DEC2007 tiene texto extraíble: 4.277 códigos definidos (P0 2.251, P2 1.177, P3 98, U0 532, B0 125,
  C0 76, U3 18) y el apéndice F0 de *Failure Type Byte*. La rev. APR2002 está escaneada (sin texto) y
  la de 2007 la reemplaza. Falta una revisión más nueva: la de 2007 deja casi vacíos P0D–P0F y P29–P2F,
  que los autos posteriores usan.
- **OBDex** (github.com/foerbsnavi/OBDex, la base de obd.signalwelt.de; datos **CC0**, se pueden
  distribuir): 9.533 códigos genéricos (P0, P2, P3, U0, U3, B0, C0) con descripción EN/DE, causas con
  probabilidad, síntomas, dificultad y costo, fuentes; sin códigos de fabricante. Contiene los 4.277
  de J2012 2007 y 5.256 más. Contra J2012: en P/U difieren mucho ~1–2 % (errores reales, p. ej.
  P2231, P2415–P2417), en B0/C0 ~25 %. Propuesta: distribuir OBDex, usar J2012 solo para verificar
  y marcar o excluir los códigos que no coinciden; B0/C0 con cautela.
- **La base de OBDient no sirve como fuente**: de sus 580 descripciones, 96 difieren mucho de J2012 y
  35 tienen otro significado (P0518 "nivel de aceite bajo" es "control de ralentí intermitente";
  P2512–P2520 "bujías de precalentamiento" son A/C y registrador de eventos).
- **Licencia**: J2012 es © SAE, "all rights reserved". Usarla para verificar y medir cobertura es
  interno; publicar sus textos en la app se decide en la revisión de licencias antes de publicar
  (como ADR-0005).
- Pendiente de definir: códigos de fabricante (P1, B1, C1, U1…), causas y pasos de revisión por
  código (J2012 solo da el nombre), idioma, y el banco de verificación con Qwen3.8 como juez.

### E7 · Diagnóstico del fabricante (después de M2, solo lectura)

El mayor potencial sin usar. La lectura obligatoria (`03`) en general no muestra los códigos B, C y U
de ABS, airbag, carrocería y caja.

- Direccionamiento físico a cada módulo (`ATSH 18DA28F1`; control de flujo con `STCFCPA` en STN,
  `ATFCSH`/`ATFCSD`/`ATFCSM` en ELM327). Las direcciones cambian por marca.
- UDS de solo lectura: **`19`** lee códigos con su estado (3 bytes: código + *Failure Type Byte*,
  apéndice F0 de J2012) y **`22`** lee datos del fabricante (temperatura de la caja, vida útil del
  aceite).
- Referencia: **ISO 14229-1:2013** (PDF entregado por el usuario, © ISO, no se versiona): §11.3 servicio
  `19` y sus subfunciones, anexo D.2 byte de estado del código (bit 0 falla ahora, 2 pendiente,
  3 confirmado, 7 pide la luz de falla), §10.2 servicio `22`, anexo C.1 identificadores estándar que
  sirven en cualquier marca (`F190` VIN, `F187` número de repuesto, `F18C` serie, `F189`/`F195`
  versión de software), anexo A.1 códigos de respuesta negativa.
- Necesita datos de cada marca: direcciones de módulos, identificadores de `22` propios y sus fórmulas.
- Lista de **permitidos**, no de prohibidos: solo `19`, `22`, `3E` y `10 01`. La norma tiene muchos
  servicios que cambian el auto además de los obvios: `11` reinicia la ECU, `28` corta su comunicación,
  `2F` acciona actuadores, `85` apaga el registro de códigos.
- **Nunca** `2E` (escritura), `31` (rutinas), `14` (borrado del fabricante) ni `27` (acceso de
  seguridad). Si un dato pide sesión extendida (`10 03`), se decide aparte.

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
