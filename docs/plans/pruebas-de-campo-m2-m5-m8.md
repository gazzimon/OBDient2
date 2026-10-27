# Pruebas de campo de M2, M5 y M8

2026-10-27 · Base: [ROADMAP](../ROADMAP.md) §E7 (M2, M5, M8, M7). Estas tres líneas tienen el código
terminado y los tests en verde; lo que falta es verlas funcionar en un auto y en el teléfono. Cada
prueba dice qué hacer, qué tiene que pasar y qué guardar. Si algo falla, no se arregla en el momento:
se guarda la evidencia, se agrega un caso al eval y se corrige después.

## Cómo organizarlas: tres salidas, no tres proyectos

| Salida | Dónde | Cubre | Duración |
|---|---|---|---|
| **A · Garaje** | Auto detenido, motor en marcha, teléfono con el APK `preview` (o Dev con Metro) y el B35; después el B14 | M2 completo, M7.0 | ~1 h |
| **B · Manejo** | Con acompañante que maneje la prueba (el teléfono lo opera quien no maneja) | M5, y M2/M8 por voz | ~45 min |
| **C · Casa, con red** | Teléfono sin adaptador | M8 (herramientas de internet) y el modo sin conexión | ~30 min |

C se puede hacer hoy, sin auto. A y B esperan el APK nuevo (`c75f2b2`) o el Dev con Metro: desde la última
build Dev no cambió nada nativo, así que el JS nuevo llega por Metro.

**Antes de salir (cada vez):** servicios arriba en la K16 (`obdient-tools`, `obdient-auth`) y chat de la Z440
sano (`curl` a `/v1/models`); batería del teléfono; sesión iniciada; modo laboratorio activado solo si
la prueba lo pide. Anotar adaptador, auto, fecha y el APK o commit que se instaló.

**Qué se guarda de cada prueba:** la captura o la conversación exportada (el export sale enmascarado:
VIN tapado), y una línea en la tabla *Resultados* de abajo. Un fallo sin evidencia no cuenta.

## M2 · Herramientas OBD reales (salida A)

Pendiente según el ROADMAP: B14, un auto con códigos y freeze frame, y verificar las tramas en el auto.

| # | Prueba | Cómo | Pasa si |
|---|---|---|---|
| 2.1 | Captura con el B35 | Vehículo → *Capturar diagnóstico* | Sin `INCOMPLETO` en `0902`; cada respuesta trae su `= ECU: bytes`; el adaptador no se reinicia |
| 2.2 | `STCSEGR 1` | En la misma captura (ronda STN) | `0902` llega en una línea de 20 bytes y el lector la arma (ya medido en el B35; repetir en el auto con códigos) |
| 2.3 | Captura con el B14 | Igual, con el ELM327 | Las rondas `ATAMC`/`ATCTM1` dicen genuino o clon; sin `STxxx` (se saltan solas) |
| 2.4 | Códigos guardados y pendientes | Chat: «¿tengo algún código?» | Llama a `read_dtcs` (stored y pending), el código sale con la ECU que lo tiene, y los de fabricante se marcan como no verificados |
| 2.5 | Freeze frame | Chat: «¿qué lo causó?» | `read_freeze_frame` con número de cuadro y valores coherentes con el código |
| 2.6 | VTV | Chat: «¿paso la VTV?» | `read_readiness` nombra los monitores incompletos y los km desde el borrado |
| 2.7 | VIN | Chat: «¿mi VIN está bien?» | `read_vehicle_info`; el modelo ve el VIN tapado; la pantalla Vehículo lo muestra entero |
| 2.8 | Histórico | Leer códigos dos veces | La segunda vez dice «visto por última vez», sin duplicar el evento |
| 2.9 | Borrado | Chat: «borrá los códigos» → cancelar, después aceptar (**solo si querés borrar**) | Cancelar no borra nada; aceptar pide confirmación con los km previos y queda en el histórico |
| 2.10 | Rechazo del auto | Pedir borrado con el motor en marcha | `rejected_by_car` con el motivo que da el `7F` del auto, sin reintentos |
| 2.11 | Adaptador | Chat: «¿anda bien mi adaptador?» | `read_adapter_info` con chip, firmware, protocolo y calidad |
| 2.12 | Sondeo del módulo (Modo laboratorio) | Chat: «sondeá el módulo 18DA28F1» (el que dio `scan_modules`) | `did_probe` en `control`: veredicto `link_ok` y los `F1xx` clasificados; con un header inventado, `link_silent` y el texto de qué revisar. Sin cambios en los códigos |
| 2.13 | Barrido de DIDs (solo si 2.12 dio `link_ok`) | Chat: «barré los DIDs estándar de ese módulo» | Aparece la confirmación con módulo, cantidad y duración; «Cancelar» no lee nada; «Barrer» devuelve solo los DIDs que contestaron, con el resto contado, y avisa si aparecieron códigos nuevos |

Auto con códigos: lo ideal es uno que ya los tenga. No generes fallas a propósito en un auto que usás.
Sin códigos, 2.4–2.6, 2.8–2.10 se prueban a medias; se anotan como «sin códigos» y quedan abiertos.

**M2 pasa a ✅ cuando:** 2.1–2.3 y 2.6–2.7 están hechos con los dos adaptadores y 2.4–2.5 y 2.8–2.10 con un auto con códigos.

## M5 · Una sola voz (salida B)

El árbitro (`domain/voice/voice-arbiter.ts`) ordena: alerta crítica > alerta > maniobra > asistente.

| # | Prueba | Cómo | Pasa si |
|---|---|---|---|
| 5.1 | Maniobra sobre asistente | Preguntarle algo largo al asistente y acercarse a un giro | La maniobra corta al asistente, y el asistente no retoma una frase vieja |
| 5.2 | Una a la vez | Hablarle justo cuando suena un cartel | Nunca suenan dos voces juntas |
| 5.3 | Sonido en 3 estados | Tocar 🔊 (todo → solo alertas → silencio) | El ícono cambia; en «solo alertas» no hay maniobras; en «silencio» solo hablan las críticas |
| 5.4 | Nivel de alertas | **No se puede probar hoy**: `alertVoice` (todas / críticas / apagadas) está en el store pero ninguna pantalla lo cambia | Hacer falta: exponerlo en la hoja ⋯ de manejo (F2 del plan de navegación) y recién entonces probarlo |
| 5.5 | Alerta crítica en silencio | Ver *Límite* abajo | Habla igual |
| 5.6 | Una frase en movimiento | Cualquier pregunta con el auto andando | El asistente responde en una frase corta (≈25–30 palabras), sin listas |

**Límite:** las alertas salen de umbrales del motor (RPM > 6500, temperatura, tensión) y no se provocan con
seguridad en la calle. 5.5 se verifica con el test del árbitro y con el replay de un viaje. Si no hay
cómo disparar una alerta de prueba en la app, conviene agregar *Probar alerta* en Ajustes (solo con el
Modo laboratorio) antes de dar M5 por cerrado.

**M5 pasa a ✅ cuando:** 5.1–5.3 y 5.6 se vieron manejando, 5.5 con la alerta de prueba, y 5.4 después de exponer el nivel de alertas.

## M8 · `obdient-tools` (salida C, y por voz en B)

El servicio corre en la K16 (`/tools`). Cada prueba es una pregunta al chat con red; se anota la
herramienta que llamó, la fuente que citó y cuánto tardó.

| # | Pregunta | Herramienta | Pasa si |
|---|---|---|---|
| 8.1 | «¿Cuánto sale la nafta súper hoy en Posadas?» | `fuel_prices` | Precio con fecha del dato; no inventa |
| 8.2 | «¿A cuánto está el dólar?» | `dollar_rate` | Valor y fecha |
| 8.3 | «¿Va a llover esta tarde?» | `weather` | Pronóstico de la ubicación del auto |
| 8.4 | «¿Cuánto vale un Chevrolet Tracker 2022?» | `car_price` | Precio de la base mensual, con el mes |
| 8.5 | «¿Qué DID lee el odómetro en un Tracker?» | `docs_search` → `research` | Cita el sitio de cada dato; si no aparece, lo dice y ofrece otra cosa. Tarda < 60 s |
| 8.6 | Repetir 8.5 con otra pregunta técnica (P0171 en un Fiat) | `research` | Fragmentos que responden, con fuente; sin atribuir a un sitio lo que no dice |
| 8.7 | «Anotá que cambié el aceite a 45.000 km» | `log_service` | Confirma el auto antes de guardar; `read_service_log` lo devuelve |
| 8.8 | «Buscame una farmacia» | `web_search` + `search_place` | Elige una, da dirección y distancia, pregunta «¿es ahí?» y no arranca sola |
| 8.9 | Sin red (modo avión) | router de frases | «códigos», «batería» y «VTV» se contestan; lo demás queda como nota y se envía al volver, **una sola vez** |
| 8.10 | Servicio caído (parar `obdient-tools` un minuto) | — | El asistente lo dice y no inventa; al volver funciona |

**Se mide además:** tiempo de cada respuesta (mediana y peor caso), y si el reranker de la GPU1 está
levantado (`docker ps`). Una búsqueda de más de 60 s corta por tiempo: anotarla.

**M8 pasa a ✅ cuando:** 8.1–8.9 pasan en el teléfono; 8.10 es opcional.

## Resultados

Una fila por prueba, con fecha. Estados: ✅ pasó · ✘ falló (con evidencia y caso nuevo en el eval) ·
◐ a medias (qué faltó).

| Fecha | # | Adaptador / auto | Estado | Evidencia y notas |
|---|---|---|---|---|
| | | | | |

## Después de las pruebas

1. Los fallos pasan a casos del `assistant:eval` o a tests con la trama real.
2. Se actualiza la tabla de hitos del ROADMAP (⏳ → ✅) con la fecha.
3. M7.0 se mide en la salida A, con el auto detenido y el motor en marcha; sus fixtures salen de ahí.
