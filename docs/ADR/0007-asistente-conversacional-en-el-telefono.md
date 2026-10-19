# ADR-0007 — Asistente conversacional: el loop en el teléfono, el modelo en el servidor

**Estado:** propuesta · 2026-10-18

## Contexto

La app va a tener un chat con Qwen3.8-27B (Z440, `llm-chat`) que lee el auto a través del adaptador
OBD-II (BLE, STN1040). El modelo no puede hablar con el adaptador directamente: alguien tiene que
ejecutar las herramientas.

Hechos verificados (2026-10-18):
- El adaptador solo es alcanzable desde el teléfono (BLE). Una herramienta que viaje al servidor
  implica un canal con estado por 4G.
- Qwen3.8-27B acepta **texto e imágenes**; su configuración no tiene componente de audio.
- Con thinking desactivado: primer token en ~0,2 s y ~41 tokens/s (pruebas en la Z440).
- Las llamadas a varias herramientas en paralelo funcionan, también con streaming.

## Decisión

1. **El loop de agente corre en el teléfono.** Ejecuta las herramientas contra la sesión BLE, aplica
   la política de seguridad y pide confirmación en pantalla. El servidor solo responde
   `chat/completions`, sin estado.
2. **El servidor no ve el auto ni el adaptador.** Recibe mensajes de texto (y, cuando el usuario lo
   adjunte, imágenes) y devuelve texto o llamadas a herramientas.
3. **La voz se resuelve en el teléfono.** Entrada: reconocimiento de voz del sistema, con el paquete
   de español descargado para que funcione sin red. Salida: `expo-speech`. El modelo recibe siempre
   texto, nunca audio.
   *Actualización 2026-10-19 (M6):* entrada con `expo-speech-recognition` (reconocedor de Android),
   botón de micrófono en el chat, el texto entra por el mismo `send()` que lo escrito; sin red pide
   reconocimiento en el teléfono. Whisper en la Z440 queda como mejora si el reconocedor no alcanza
   con el ruido del auto: el mismo módulo puede guardar el audio para enviarlo, sin otro build. Un solo
   reconocedor a la vez (el micrófono es exclusivo).
   *Actualización 2026-10-19 (decisión del usuario):* con conexión, **Voxtral Mini 4B Realtime** en la
   GPU1 de la Z440: el teléfono manda PCM16 a 16 kHz en vivo (`expo-audio`, `useAudioStream`) por
   WebSocket a `obdient-tools` (`/tools/v1/stt`, con la clave de la cuenta), que lo pasa a vLLM
   `/v1/realtime`; vuelve texto parcial mientras se habla y el final al terminar (silencio de 1,2 s o
   un toque). Sin conexión, o si el servidor no responde al empezar, el reconocedor de Android. El
   modelo del chat sigue recibiendo solo texto. Descartados: Voxtral Small 24B (no entra en 24 GB),
   Voxtral Mini 3B y Whisper/Qwen3-ASR (sin texto en vivo; quedan como alternativa si Voxtral no
   alcanza con el ruido del auto).
   *Medido el mismo día (llamadas reales en español, MINDS-14):* texto casi exacto con puntuación; primer
   fragmento a 0,6–1,7 s, final 1–1,5 s después de terminar de hablar. Voxtral corta la frase tras ~0,5 s
   de silencio digital casi total (con ruido de fondo realista no pasa): la app suma ruido de confort a
   los trozos casi mudos antes de enviarlos. Salida: una sola voz con prioridades (alertas >
   maniobras > asistente, `domain/voice/voice-arbiter.ts`); el asistente todavía no habla (decisión
   del usuario, se retoma con el modo manejo).
4. **Las imágenes son entrada válida.** Foto de un testigo del tablero, de una etiqueta o de un
   repuesto, enviada desde el selector de archivos del chat.
5. **Herramientas, con política por nivel:**
   - Lecturas (PIDs, códigos, freeze frame, readiness, info del adaptador): permitidas en cualquier
     momento; con el auto en movimiento, solo las que no cambian el estado del adaptador.
   - Benchmark del adaptador: bloqueado en movimiento y con navegación activa.
   - Borrado de códigos: siempre con modal de confirmación. Muestra la advertencia de acción
     destructiva y los km desde el último borrado. Cada borrado queda en el histórico de fallas.
   - No se expone ningún comando AT/ST crudo.
6. **Con el auto en movimiento** (OBD > 5 km/h o GPS > 7 km/h, con histéresis): respuestas de una
   frase, sin listas, y la voz tiene prioridad menor que las alertas de manejo y la guía de ruta.
7. **Conversaciones largas:** resumen automático al acercarse al límite de contexto (16k). El
   historial vive en el teléfono (MMKV), con resúmenes editables.
8. **Memoria de largo plazo:** no se usa Honcho por ahora. Se guardan un resumen por conversación y
   un perfil corto del auto (motor, kilometraje, últimos códigos). Se revisa cuando haya muchos
   usuarios.
9. **Cifrado del historial:** pospuesto. Se revisa antes de distribuir. El almacenamiento va detrás
   de una interfaz para que el cambio sea local.
10. **Sin chat social dentro de la app.** Comunidad, si hace falta, en un foro externo. Ver
    ADR-0008 para identidad.
11. **Chat senior de OBDient:** no se porta. Su rol lo cubre este asistente.

## Consecuencias

- Se pierde la posibilidad de que el servidor ejecute herramientas por su cuenta. Es intencional. Las
  herramientas que necesitan internet (búsqueda web, comercios) las sigue pidiendo el teléfono a un
  servicio propio sin estado (`obdient-tools`, hito M8), que devuelve solo datos estructurados.
- El prompt y el catálogo de herramientas viajan dentro del APK. No son secretos. Si hiciera falta
  ocultarlos, el gateway puede inyectarlos (ADR-0008).
- Sin servicio, la pestaña sigue abriendo. Las frases comunes ejecutan la herramienta directamente
  (modo determinista), sin modelo.
- La calidad del español rioplatense y del formato depende del prompt y del muestreo. Se fija con un
  conjunto de evaluación de ~20 preguntas antes de la beta.
- La decisión de texto-solo para el modelo cierra la opción de audio nativo hasta que haya un modelo
  con audio servido en la Z440. Si cambia, se hace con un ADR nuevo.

## Alternativas descartadas

- **Loop en el servidor:** cada lectura del auto sería una ida y vuelta por 4G con sesión BLE
  remota. Más latencia, reconexiones complejas y la confirmación humana queda lejos del auto.
- **Asistente de voz local separado del modelo:** el teléfono ya trae reconocimiento y síntesis de
  voz; un componente aparte solo suma peso.
- **Audio directo al modelo:** el modelo elegido no lo soporta.
