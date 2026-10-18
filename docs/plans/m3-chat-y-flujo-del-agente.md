# Plan: M3 (chat con el auto detenido) y flujo del agente

2026-10-18 · Base: ADR-0007 (asistente), ADR-0008 (cuentas), ROADMAP §E7. Hitos M0–M7 del plan
original del asistente.

## 1. Dónde quedó M2

**En código está completo; en el auto falta verificarlo.**

| Paso | Código | En el auto |
|---|---|---|
| M2.0 Captura de diagnóstico | ✅ | ✅ B35 sin códigos · ⏳ B14 · ⏳ un auto con códigos y freeze frame |
| M2.1 Lectura de tramas | ✅ | ✅ B35 (todas las respuestas bien armadas) |
| M2.2 Parsers | ✅ | ✅ monitores y VIN · ⏳ códigos y freeze frame reales |
| M2.3 Sesión | parcial | — |
| M2.4 Herramientas | ✅ | ⏳ nunca corrieron contra el auto |
| M2.5 Histórico de fallas | ✅ | ⏳ se llena con el uso; falta verlo |

Lo que falta de M2, en este orden:

1. **Probar las herramientas en el auto.** El plan original pedía un botón de depuración en
   Vehículo. Propuesta: no hacerlo. M3 es esa prueba, porque el chat ejecuta las 9 herramientas.
2. **Restos de M2.3**, chicos e independientes:
   - `read_pids` usa el valor del Tablero si tiene menos de 2 s, sin ir al bus;
   - `STVR` en lugar de `ATRV` cuando es STN;
   - si llega un `LV RESET` en medio de una herramienta, esperar la recuperación y reintentar una vez;
   - `sample_pids` rotando los PIDs en la telemetría, en vez de pedidos sueltos;
   - `STPX r:/t:` en diagnóstico.
3. **Fuera de M2, ya anotado en el ROADMAP:** el B14, un auto con códigos, el protocolo guardado por
   vehículo y la energía del ELM327 en fábrica.

## 2. Flujo del agente

Todo el ciclo corre en el teléfono. El servidor solo responde `chat/completions` y no ve el auto
(ADR-0007).

```
 usuario escribe (M3) / habla (M6)
        │
        ▼
 ┌─ Pantalla Asistente ───────────────────────────────────────────────┐
 │ ¿hay cuenta?  no → "Entrá con Google para usar el asistente"       │
 │ contexto: conectado, protocolo, PIDs, en movimiento, navegación    │
 └────────┬───────────────────────────────────────────────────────────┘
          ▼
 runTurn (domain/assistant/agent-loop.ts) · hasta 4 llamadas al modelo
   1. historial recortado a ~10k tokens (sin partir pares herramienta/resultado)
   2. system prompt + 9 herramientas (fijas: el servidor las cachea)
   3. ──► modelo (new-api → Qwen3.8 en la Z440), en streaming ──► texto en pantalla
   4. si pide herramientas:
        validar argumentos (nunca se reparan) ─✗─► se rechaza y se cuenta
        política: lectura | exclusiva | destructiva
           en movimiento: muestreo ≤ 5 s; banco y borrado rechazados
           borrado: modal de confirmación ─ no ─► declined_by_user
        memo de 10 s (no repite la misma lectura)
        VehicleToolAdapter ──► sesión OBD ──► auto
           diagnóstico con ATH1 (ECU de cada código) · en movimiento sin encabezados
           lee/borra ──► histórico de fallas (MMKV, por VIN)
        resultados ──► vuelven al modelo (son datos, no instrucciones)
   5. si responde con texto: fin. Si no hubo texto: respuesta armada con los resultados.
          │
          ▼
 historial guardado (MMKV) · clave rechazada (401) → se renueva una vez con la cuenta
```

**Lo que existe:**
- el ciclo y su política (M1);
- las herramientas reales (M2);
- el cliente HTTP con streaming;
- la cuenta y la clave por usuario.

**Lo que agrega M3:** la pantalla, el estado de las conversaciones, el modal de borrado y la
conexión entre todo lo anterior.

**Etapas futuras del flujo** (no son de M3):

| Etapa | Hito | Qué hace |
|---|---|---|
| Base de conocimiento | RAG | `DtcDescriber` deja de estar vacío: la descripción de cada código sale de J2012 con su origen |
| Verificación | RAG | Revisor fuera de línea: atomiza respuestas reales y las verifica contra la base. Banco, no camino en vivo (medido en la Z440) |
| Router determinista | M4 | Sin servicio, las frases comunes ejecutan la herramienta sin modelo |
| Modo manejo y voz | M5, M6 | Árbitro de voz: alertas y guía tienen prioridad sobre el chat |
| Diagnóstico del fabricante | aparte | Herramientas UDS de solo lectura (`19`, `22`) por módulo |

## 3. M3: alcance

**Objetivo:** chatear con el auto detenido, con todas las herramientas reales, el historial guardado
y el borrado con confirmación. Es además la prueba de M2 en el auto.

### Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| `AssistantService` | `data/assistant/` | Arma el cliente con la clave de la cuenta, ejecuta `runTurn`, renueva la clave ante un 401 y reintenta una vez, y cancela con "Detener" |
| Contexto | `presentation/hooks/` | `AssistantContext` desde el store OBD (conexión, protocolo, velocidad) y la navegación |
| `chatStore` | `store/` | Conversaciones en MMKV: forma de la API (se reenvía) y forma de UI. Máximo 20 conversaciones de 200 mensajes; versión y migración |
| Pantalla **Asistente** | `app/(tabs)/assistant.tsx` | Burbujas (`ChatBubble` portado de OBDient), texto en streaming, filas de herramienta en curso, Detener, entrada, ejemplos en el estado vacío, conversación nueva y lista de conversaciones |
| Modal de borrado | `presentation/components/` | Implementa `ConfirmationPort`: advertencia destructiva, km desde el último borrado (auto + histórico), aviso si el motor está en marcha, aviso de VTV |
| Histórico de fallas | Vehículo → *Historial de fallas* | Lista de eventos por auto (M2.5): apareció, desapareció, borrado, freeze frame |
| Sin cuenta | pantalla Asistente | Invitación a entrar con Google; el resto de la app sigue igual |
| Registro por turno | `chatStore` | Llamadas al modelo, herramientas, inválidas y latencias: es la materia prima del conjunto de evaluación |

### Orden de trabajo

1. **M3.0 Servicio y estado** (sin UI): `AssistantService`, `chatStore` y contexto. Tests con un
   modelo falso guionado y el `VehicleToolAdapter` sobre la sesión simulada.
2. **M3.1 Pantalla**: pestaña Asistente, burbujas, streaming, herramientas en curso, Detener.
3. **M3.2 Borrado**: modal con km y avisos; una vez por conversación.
4. **M3.3 Historial de fallas** en Vehículo.
5. **M3.4 Conjunto de evaluación** (~20 preguntas, `scripts/assistant-eval.ts`): modelo real y auto
   simulado. Mide la regla "medí en este turno" (falló en la prueba del 18/10), los códigos de
   fabricante, el formato y el rioplatense. Corre antes de cambiar el prompt.
6. **Build Dev y prueba en el auto.**

### Aceptación en el teléfono

Con el B35 en el auto, motor en marcha, detenido:
- "¿Cómo está la batería y tengo códigos?": mide en el turno, responde en < 10 s.
- "Mostrame el freeze frame" y "¿los monitores están listos?": datos reales.
- "Borrá los códigos": el modal aparece. Cancelar → no se borra nada. Aceptar → el auto confirma
  (o rechaza con su motivo) y queda en el histórico.
- Cerrar y reabrir la app: la conversación sigue.
- Modo avión a mitad de respuesta: error claro, nada colgado, se puede reintentar.
- La velocidad OBD vuelve a su tasa después de cada herramienta.

Tests: el reducer y la persistencia del `chatStore` con migración, `AssistantService` con 401 →
renovación, cancelación a mitad, y el modal (aceptar, cancelar, segunda vez en la conversación).

### Estado (2026-10-18)

M3.0 ✅ · M3.1 ✅ · M3.2 ✅ · M3.3 ✅ · M3.5 ✅ (foto ≈ 1,5k tokens; probada contra Qwen3.8) ·
M3.4 ✅ `npm run assistant:eval` (21 casos). **Línea de base, 2 corridas: 40/42.** Fallas
intermitentes: 03 (en el turno 2 usa los códigos leídos segundos antes en vez de releer; 1 de 3) y 07
(26 palabras en movimiento, máximo 25). **Probado en el auto con el B35 el 2026-10-18: todas las pruebas
de aceptación OK** (batería y códigos, monitores, VIN, muestreo, adaptador, borrado cancelado, foto).

**Después de la prueba en el auto (2026-10-18):** se leyeron las 5 conversaciones del teléfono (MMKV vía
`run-as`) y salieron 4 errores: decía "no tengo visión" con una foto, calculó el consumo 3× bajo, alarmó
por el dígito verificador de un VIN argentino y no tenía acceso al historial. Arreglados con prompt,
`calculate`, `fuelEstimate` calculado por la app, el dígito solo para VIN norteamericanos y
`read_fault_history`; más `read_adapter_info` con `full_check` (test de conexión en el chat). La
evaluación pasó a 26 casos: 24/26 (las dos fallas, de forma e intermitentes).

## 4. Decisiones (2026-10-18)

1. **Pestaña "Asistente"**, la quinta. En M5 se suma el micrófono flotante en la AR.
2. **Fotos en el chat:** sí, en M3.5 (selector o cámara, reducida a ~1024 px).
3. **VIN completo** al modelo y en pantalla: no hay problema en mostrarlo.
4. **Borrar con el motor en marcha:** se avisa, no se bloquea; el auto puede rechazarlo (`7F 04 22`).
5. **Resumen de conversaciones largas:** en M4.
6. **Chat en movimiento:** permitido con la política actual.

## 5. Después de M3

1. **M4 · Offline y errores:** router determinista (portado de `chat-commands.ts`), salud del
   servicio, "no enviado · reintentar", resumen de conversaciones largas.
2. **Base de conocimiento y RAG:** J2012 con origen, `DtcDescriber`, banco de verificación con
   Qwen3.8 de juez.
3. **Firestore:** histórico de fallas y VIN por cuenta.
4. **M5 Modo manejo, M6 Voz, M7 STN a fondo** (multi-PID, muestreo rápido).
5. **Diagnóstico del fabricante** (UDS de solo lectura).
