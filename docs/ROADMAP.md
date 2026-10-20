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
| **E7 Asistente** | Chat por texto, voz e imágenes con herramientas OBD (ADR-0007), cuenta por correo y gateway new-api (ADR-0008) | ✅ M0–M3: chat con las 9 herramientas, fotos, borrado con confirmación, login por correo; probado en el auto con el B35 (2026-10-18) · ✅ M4 (código y 388 pruebas; falta probar en el teléfono) |
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

### E7 · Hitos del asistente (estado 2026-10-19)

| Hito | Qué | Estado |
|---|---|---|
| M0–M1 | Gateway y loop del agente (ADR-0007/0008) | ✅ |
| M2 | Herramientas OBD reales (tramas, parsers, sesión, adaptador) | ✅ código · ⏳ B14 y un auto con códigos |
| M3 | Chat, fotos, borrado con confirmación, historial de fallas, evaluación | ✅ probado en el auto (B35) |
| Cuentas | Login por código de correo (Magic), clave por cuenta | ✅ |
| Navegación | Direcciones, esquinas, enlaces de mapas, destino confirmado en el chat | ✅ probado en el teléfono |
| M4 | Sin conexión (router de frases, notas), resumen de conversaciones largas | ✅ |
| M5 | Una sola voz: alertas > maniobras; nivel de alertas | ✅ código · ⏳ probar manejando |
| **M6** | **Voz al chat**: Voxtral Mini 4B Realtime en la GPU1 (en vivo, por `obdient-tools`), reconocedor de Android sin conexión | ✅ cerrado (2026-10-20): probado en el teléfono; en manejo, conversación por voz con subtítulos, ≤ 60 palabras y escucha continua |
| **Manejo** | **Modo manejo** (F1 del [plan](plans/modo-navegacion-ux.md)): mapa 3D/2D, cartel con "luego", riel (hablar, sonido en 3 estados, GPS), barra de viaje y acciones rápidas; YOLO fuera (rama `etapa-camara`); mapa en el chat, animaciones de espera, teclado | ✅ cerrado como MVP (2026-10-20), con detalles estéticos pendientes · F2–F6 siguen en el plan |
| — | APK standalone y prueba todo junto manejando | **ahora** (2026-10-19) |

**Decisión 2026-10-20 (cámara, cierre):** la guía AR sale del código (preservada en la rama
`etapa-camara`, igual que YOLO) junto con VisionCamera, la calibración y la pantalla de cámaras. La
navegación es solo mapa. La cámara pasa al **Tablero** como una vista más (`Medidores | Cámara`, con
`expo-camera`): la imagen, km/h y RPM grandes, temperatura y batería, aviso "mirá la calle" en
movimiento, y el asistente igual que en manejo (🎤, subtítulos, escucha continua) más 📷: la foto va al
asistente con la pregunta que se diga.

**Decisión 2026-10-19 (cámara):** se deja de invertir en la navegación por cámara. Con el APK standalone se
hace la prueba manejando; si la cámara sale mal, la guía AR, el detector YOLO y Qwen-Drive se cierran en
esta etapa y vuelven más adelante. Requisito nuevo: **la app tiene que correr en teléfonos de gama baja**.
**Resultado (prueba manejando con el APK, 2026-10-19): cerrado para esta etapa.** YOLO detectó cualquier
cosa y sus avisos no fueron acertados. La guía AR, el detector y Qwen-Drive pasan a la **siguiente etapa**;
el código queda, apagado (la cámara solo se monta con el ajuste "Cámara en manejo"). Foco de esta etapa:
**el agente conversacional y la navegación** (plan en [plans/modo-navegacion-ux.md](plans/modo-navegacion-ux.md)).
Estado al cerrar: el detector corre (corregido el orden de las funciones worklet) pero no se validó que
detecte; la captura de cuadros para el maestro queda apagada (copiar ~3,6 MB por cuadro al hilo JS
trababa la cámara y cerraba la app en `libworklets`).
| **Historial** | Conversaciones: botón junto a "nueva" ✅, compartir ✅; lista agrupada por fecha y buscador (pendiente). **Mis viajes** ✅ código (2026-10-20): automático con la app abierta y el OBD conectado, lista simple, detalle con mapa por velocidad, paradas, consumo, códigos, GPX. **Traccar** ✅ en la K16 ([server/traccar](../server/traccar/README.md)): posición en vivo opcional vía `obdient-tools` (`/tools/v1/track`), web en la red local | ⏳ probar en un viaje |
| M7 | STN a fondo: multi-PID, muestreo rápido, `STPX` | pendiente |
| M8 | `obdient-tools`: búsqueda web (SearXNG), combustibles y dólar (diario), clima, precios de autos (CCA, mensual); registro de service en el teléfono · pendiente: comercios (HERE), LiteLLM | ✅ código, servicio y ruta `/tools` en la K16 (2026-10-19) · falta probar en el teléfono |
| M9 | Diagnóstico del fabricante (UDS solo lectura). **En curso (2026-10-20):** `scan_modules` (barrido 11/29 bits, 3E/22 F190), `obd_command` (trama de lectura libre en Modo laboratorio, clasificador que bloquea escritura/flasheo/reinicio), base de conocimiento compartida del laboratorio (`knowledge_lookup`), y `web_fetch` para leer fuentes técnicas. Datos de marca vía **gemelo del adaptador** Datos de marca vía **gemelo del adaptador** en modo laboratorio ([ADR-0009](ADR/0009-gemelo-del-adaptador-modo-laboratorio.md)) | pendiente · después de cerrar la navegación |
| Después | Modo manejo sin chat (voz de ida y vuelta, palabra "OBDient"), animaciones de espera, base de conocimiento ampliada | ideas |

**Herramientas del asistente (24, 2026-10-19).** Auto: read_pids, sample_pids, read_dtcs,
read_freeze_frame, read_readiness, read_vehicle_info, read_adapter_info, run_adapter_bench, clear_dtcs,
read_fault_history · Cuenta: calculate · Navegación: search_place (direcciones y esquinas),
set_destination, start_navigation, route_status, stop_navigation, where_am_i · Internet (obdient-tools):
web_search (con precios y direcciones de los fragmentos), fuel_prices, dollar_rate, weather, car_price ·
Teléfono: log_service (confirmando el auto, hasta que exista el garage), read_service_log. Con 24 se
revisa si conviene un router (ver *Otros pendientes*).

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
- [x] **M2.3 Sesión** (2026-10-18): `exclusive()` para banco, captura y diagnóstico; todos los PIDs
  soportados; `read_pids` usa el valor del Tablero si tiene < 2 s (sin ir al bus); tensión con `STVR`
  en STN; una lectura interrumpida por `LV RESET` espera la recuperación y se reintenta una vez (el
  borrado y el banco no). Descartado, por simple: muestreo rotando en la telemetría (las lecturas
  intercaladas no frenan la velocidad) y `STPX r:/t:` en diagnóstico (poca ganancia sobre `ATH1`, a
  M7).
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

**2026-10-18: identidad cambiada a correo con código (Magic).** El login con Google funcionó hasta el
servidor (el fallo era `obdient-auth` con el token viejo de new-api en memoria), pero se reemplaza por
simplicidad: código por correo, aprobación de dispositivos nuevos, sin Firebase ni Google. Migración a
Supabase Auth si se pasan los 1.000 usuarios activos por mes. **Probado en el teléfono el 2026-10-18:**
código por correo → `obdient-auth` (modo Magic) → clave de la cuenta en new-api (activa, solo
`obdient-chat`, una por cuenta).


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
- [x] Claves de new-api nombradas con el correo de la cuenta (los logs de uso muestran quién es); las
  viejas `fb-…` se renombran solas en el próximo login, misma clave y cuota (2026-10-18).
- [ ] **Después del MVP: migrar de new-api a LiteLLM Proxy** (con la cadena de respaldo Qwen3.8 Z440 →
  Qwen3 4B K16 → modelo en la nube con presupuesto, y el servidor MCP de lugares; ver
  [plans/voz-y-lugares.md](plans/voz-y-lugares.md)). new-api identifica claves, no personas
  (todo cuelga de `obdient2app`) y su límite de pedidos por minuto es por usuario, o sea compartido
  por toda la app. LiteLLM tiene claves virtuales con `user_id`, límites y presupuesto por clave o
  usuario, y gasto por usuario. Cambia `server/auth/src/newapi.mjs` y la ruta `/llm` de Caddy; la app no.
- [ ] Sincronizar historial de fallas y VIN por cuenta (destino a definir: Supabase o servicio propio).
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

### E7 · Herramientas del asistente (2026-10-18)

11 herramientas: las 9 de M2.4 más `read_fault_history` (historial del teléfono, sin adaptador) y
`calculate` (aritmética segura en el teléfono). `read_pids`/`sample_pids` traen `fuelEstimate` (L/h y
L/100 km desde el MAF, calculado por la app); `read_adapter_info` con `full_check` (módulos que
responden, ELM327 genuino o copia, si se apaga solo). El dígito verificador del VIN solo se informa en
VIN norteamericanos. Salen de los errores vistos en la prueba en el auto (sin visión, consumo 3×
bajo, VIN "mal leído", "no tengo historial").

- **Router de preguntas con un modelo en el gateway: no por ahora.** Con 11 herramientas un solo modelo
  elige bien (0 llamadas inválidas en el auto). Revisar si se pasan ~25 herramientas o si se suman
  modelos especializados (visión, diagnóstico); un router suma latencia y otra pieza.
- **Herramientas en el servidor: no.** Corren en el teléfono, junto al adaptador (ADR-0007).
- [x] **Navegación por chat, PLAN 0** (2026-10-18; ver [plans/voz-y-lugares.md](plans/voz-y-lugares.md)):
  solo direcciones ("Uruguay 1223"), el más cercano primero; `set_destination` muestra el punto y la
  ruta en el mapa y pregunta; `start_navigation` arranca con el sí; `route_status`, `stop_navigation`.
  Comercios, búsqueda web (servidor MCP propio en la K16, HERE) y respaldo del modelo (LiteLLM):
  después del MVP, con la migración del gateway.
- **M4 — sin conexión y conversaciones largas (2026-10-19, hecho):**
  - *Router de frases* (`domain/assistant/phrase-router.ts`): lista fija de patrones (verbo + objeto, sin
    tildes, portada de OBDient `chat-commands.ts`): códigos, batería, VTV/monitores, freeze frame, VIN,
    "¿cuánto falta?", terminar navegación. Ante la duda no captura. Responde con plantilla desde la
    herramienta (descripciones de OBDex), sin modelo.
  - *Notas* (`offline.ts`, `symptoms.ts`): lo que no encaja se guarda como nota con los síntomas
    reconocidos y negados (tabla portada de OBDient) y una foto del auto (códigos y RPM, velocidad,
    temperatura, carga, tensión). Se anotan con red caída (NetInfo) o si el asistente no responde antes
    de mostrar nada. **Nada se envía solo**: un aviso sobre el teclado ofrece "Pasar al asistente" o
    "Descartar". Sin cola al servidor.
  - *Resumen* (`summary.ts`): los turnos que salen del contexto los resume el modelo (sin herramientas,
    ≤ 300 tokens) y el resumen ocupa su lugar como primer intercambio; si falla, se descartan como antes.
  - Pendiente: la puerta de voz (un motor Whisper con red y otro de Android sin red, nunca los dos a la vez)
    entra con M6; el router corre primero.
- **Después de la prueba en el teléfono (2026-10-19):**
  - *Enlaces de mapas* (`domain/navigation/map-links.ts`): la app lee enlaces de Google Maps, Waze y
    `geo:` antes del modelo y deja el lugar como resultado 1. Un lugar compartido de Google suele traer
    solo nombre y dirección (las coordenadas exigen su API paga): se busca la dirección y se marca
    aproximada. Los enlaces con `!3d…!4d…`, `q=lat,lng` o `geo:` son exactos.
  - *Notas*: los saludos no se anotan; "leé las notas" las envía como el botón.
  - *Sugerencias*: con conexión las **genera el modelo** después de cada respuesta
    (`next-questions.ts`: llamada aparte sin herramientas, ~1 s, en segundo plano; 3 preguntas sobre esa
    conversación, la primera responde si el asistente preguntó algo). Sin conexión, frases fijas que el
    router contesta (`suggestions.ts`). Más un botón fijo: "Ir a una dirección…", o "Ver en el mapa"
    justo después de mostrar un destino. Con el auto en movimiento: solo el botón de voz (más adelante).
  - *Prompt*: fotos de cualquier cosa y otros temas, con naturalidad. (El tope de 60 palabras se
    probó y se sacó: las respuestas quedaban escuetas.)
  - *Esquinas* (`findCorner` en `places.ts`): "Calle y Calle" se resuelve con nuestro Photon, donde se
    tocan los recuadros de los tramos de las dos calles (probado en Posadas y CABA). Overpass público
    descartado (saturado). Si no se cruzan, el modelo lo dice.
  - *Ubicación* (2026-10-19): el modelo pedía "desde dónde salís" porque no sabía que la app tiene el
    GPS. Ahora el prompt lo dice; el estado de cada mensaje lleva **solo la ciudad** ("en Posadas,
    Misiones", Photon `/reverse`, en caché 10 min o 3 km); y `where_am_i` da calle y altura cuando se la
    pide. Probado con Qwen3.8: "¿queda lejos el ministerio?" → search_place + set_destination.
  - *Destino en el chat*: `set_destination` ya no salta al mapa; "¿es ahí?" se responde en el chat con
    "Sí, vamos" / "No, es otro lugar" / "Ver en el mapa".
  - *Ideas anotadas*: animaciones ASCII de espera de `qvac_node/salud/app/public/espera-ascii.js`
    (funciones puras `dibujar(cuadro, cols, filas)`), y medir tiempos de respuesta y concurrencia en
    el gateway: con la migración a LiteLLM.
- **M5 — una sola voz (2026-10-19, código; falta probar manejando):**
  - *Árbitro* (`domain/voice/voice-arbiter.ts`, instancia en `presentation/services/voice.ts`): alerta
    crítica > alerta > maniobra > asistente. Lo más importante corta; lo demás espera (solo el último
    de cada prioridad) y se descarta si esperó demasiado (maniobra 6 s, asistente 30 s). La guía y el
    detector ya no llaman a `expo-speech` directo.
  - *Revertido el mismo día* (decisión del usuario, keep it simple): el asistente no habla, y
    "silencio" y `set_audio` salen del chat. La voz se retoma con M6 (grabar en el chat y mandar el
    audio) y la comunicación sin chat en modo manejo, más adelante. Queda el botón de parlante de la
    vista de manejo para la guía.
  - *Ajustes*: alertas habladas del detector: todas / solo críticas / ninguna (el destello se ve
    siempre). El interruptor "Instrucciones por voz" sigue apagando todo.
  - Sin build nuevo: `expo-speech` ya estaba. Los chips en manejo quedan para M6 (solo micrófono).
- **Permisos (2026-10-19):** un solo camino (`domain/permissions`, `presentation/services/permissions.ts`):
  al instalar, una pantalla con los tres esenciales (ubicación, Bluetooth, cámara) y su porqué; el
  micrófono se pide al usarlo. Cada función llama `ensurePermission()`: explica, pide, y si Android ya
  no pregunta (bloqueado) guía a Ajustes con la ruta exacta y al volver sigue sola. Nunca bloquea la
  app: sin un permiso solo se apaga lo que lo usa. Panel en Ajustes → Permisos con el estado de cada uno.
- **Antes del APK para probar en movimiento (decisión 2026-10-18):** navegación por chat → M4 (sin
  conexión y errores, resumen de conversaciones largas) → M5 (modo manejo: voz de salida, árbitro con
  alertas y guía, chips) → M6 (micrófono). Recién entonces el standalone y la prueba todo junto.

### Otros pendientes

- **Mapa (decidido 2026-10-19, junto a M8):** hoy las teselas vienen de OpenFreeMap (público); si el
  teléfono se queda sin conexión o sin DNS, el mapa queda con partes en blanco (MapLibre: "Unable to
  resolve host tiles.openfreemap.org").
  1. **Teselas propias en la Z440** desde el mismo extracto de OSM de Argentina que usan OSRM y Photon
     (por ejemplo, un servidor de teselas vectoriales detrás de Caddy en `/tiles`), sin depender de un
     tercero.
  2. **Teselas sin conexión** de la zona habitual (región descargada en el teléfono) y un aviso "Mapa
     sin conexión" en lugar de partes en blanco.

- **Probar en el teléfono** (build Dev + Metro): detector YOLO y captura de cuadros, corregidos para
  builds release.
- **Banco de maestros con viajes propios**: un viaje con cuadros, `make_samples.py` y los tres modelos.
- **AR**: anclar el comienzo de la línea al auto (hoy queda corrida ~2 m por el eje de la calle y ~4°
  de rumbo).
- **Antes de publicar en Google Play — ubicación (2026-10-20):** hoy la posición va al Traccar del
  laboratorio siempre que el adaptador está conectado (monitoreo vehicular en desarrollo). Para Play:
  pantalla de aviso destacado y consentimiento antes de enviar (*Prominent disclosure*), opción de
  apagarlo, política de privacidad y declararlo en *Seguridad de los datos*. Sin ubicación en segundo
  plano (solo con la app abierta), que es lo que Google revisa más estricto.
- **Distribución (idea):** mini app en Lemon (1,2 M usuarios activos, apps web dentro de su billetera)
  como canal de adquisición: vender el adaptador, ver historial y VIN, chatear con el asistente. El
  núcleo (BLE, AR) no puede ser mini app: el WebView no tiene Bluetooth.
- **Asistente: herramientas en el servidor o un modelo router** (decidido 2026-10-18: todavía no). Las
  herramientas corren en el teléfono (ADR-0007) y un solo modelo elige bien con 11 herramientas (cero
  llamadas inválidas en el auto, 24–26/26 en la evaluación). Revisar si se superan ~25 herramientas o
  si entran modelos especializados (visión, diagnóstico): ahí un router en el gateway puede valer su
  latencia.
- **Build local** (sin EAS): guía en [dev/build-local.md](dev/build-local.md), pendiente de instalar.
- **Calibración y primer viaje de AR** (postergados, ver *Decisión 2026-10-17*).

## Fuera del MVP, ya decidido

- **Servidor**: Qwen-Drive solo como ayuda opcional (ADR-0001). Su mejor uso inicial es el modo
  diferido (revisión de viajes, etiquetado), no la guía en vivo.
- **Detector**: Ultralytics YOLO nano destilado desde un maestro en la Z440; revisión de licencias diferida hasta antes de publicar (ADR-0005). Investigación en [research/deteccion-en-telefono.md](research/deteccion-en-telefono.md).
- **Rutas y teselas de producción**: OSRM + Photon autoalojados o un proveedor (ADR-0003).
