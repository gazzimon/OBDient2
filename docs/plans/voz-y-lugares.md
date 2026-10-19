# Plan: voz y lugares (M5–M6) y la arquitectura de búsqueda

2026-10-18 · Decisiones tomadas con el usuario. Criterio rector: *keep it simple*; el MVP es gratuito.

## 1. Lugares — PLAN 0 (MVP, implementado)

**Solo direcciones.** OpenStreetMap (Photon en la Z440) es bueno con calles y malo con comercios.

- "Llevame a Uruguay 1223": `search_place` busca la dirección con sesgo por la posición. Entre los
  resultados a menos de 50 km, **el más cercano primero** (en Buenos Aires: CABA a 1,2 km antes que
  Adrogué a 24). Agregar la ciudad al texto empeora el resultado ("Buenos Aires" coincide con la
  provincia), así que no se agrega. Otra ciudad se pide nombrándola: "Uruguay 1223, Rosario".
- `set_destination` **muestra el punto y la ruta en el mapa** (pestaña Ruta) y el asistente pregunta si
  es ahí. Solo con un sí, `start_navigation` arranca la guía y abre la vista de manejo.
- Si piden un comercio ("una farmacia", "la YPF"), el asistente pide la dirección.
- La búsqueda por categorías (estaciones por marca dentro de un recuadro) queda en el código
  (`findNearby`), sin ofrecerla al modelo.

## 2. Voz (M5 hecho 2026-10-19; M6 por hacer)

| Tema | Decisión |
|---|---|
| Activación | Botón para hablar y **palabra clave "OBDient"**: Porcupine (Picovoice), detección en el teléfono, solo con la vista de manejo abierta. Licencia comercial antes de distribuir |
| Voz → texto | **Whisper en la GPU1 de la Z440** (`faster-whisper`), por el gateway con la clave de la cuenta. Hay que habilitar `RECORD_AUDIO` (hoy bloqueado) |
| Texto → voz | La voz del teléfono (`expo-speech`), sin conexión. ElevenLabs descartado |
| Prioridad | **Alertas del detector > maniobras > asistente**; lo de mayor prioridad corta lo de menor |
| Silencio | Botón en la vista de manejo; "silencio" se detecta en el teléfono sobre el texto (sin modelo, sin conexión); otras formas ("callate") con la herramienta `set_audio` |
| Nivel de alertas | En Ajustes: todas / solo críticas / silenciadas |
| Pantalla | Se mantienen la pestaña Ruta (mapa y búsqueda) y el chat: dos caminos a la misma navegación |
| Lugares guardados | "Casa", "Trabajo" y últimos destinos en el teléfono (MMKV), con una herramienta. Sin RAG vectorial ni Honcho: es una lista chica y exacta |
| Sin conexión | M4: router de frases y notas en el teléfono. M6: con red Whisper (Z440), sin red el reconocedor de Android; nunca los dos a la vez, el texto entra por el mismo `send()` |
| Silencio crítico | Silenciado, las alertas críticas suenan igual; "Ninguna" en Ajustes las calla también |

## 3. Después del MVP: comercios, búsqueda y respaldo (con la migración del gateway)

Se hace junto con la **migración de new-api a LiteLLM** (ROADMAP, cuentas).

**Servicio de herramientas propio en la K16 (`obdient-tools`), un servidor MCP:**

```
Teléfono (agente) ──JSON-RPC/HTTPS──► obdient-tools (K16, MCP)
                                        places_search ─► HERE (comercios) · Photon (direcciones)
                                        web_search    ─► Tavily / Brave / Exa
                   ◄── solo datos estructurados: nombre, dirección, coordenadas, categoría
```

- La búsqueda web nunca le pasa texto de páginas al modelo: el servicio extrae direcciones, las valida
  con HERE/Photon y devuelve campos. Es la defensa contra la inyección de instrucciones.
- Otros agentes (Claude) pueden usar el mismo servidor MCP.

**Proveedores, por costo (2026, a verificar en sus páginas antes de contratar):**

| Uso | Opción | Gratis | Después |
|---|---|---|---|
| Comercios | **HERE** (preferido) | ~30.000 consultas por mes | ~US$0,83–1 cada 1.000 |
| Comercios | Mapbox / TomTom (MCP oficiales) | según plan | según plan |
| Comercios | Google Places | — | pago; exige mapas de Google (no encaja con MapLibre/OSM) |
| Búsqueda | Tavily / Brave / Exa | 1.000 créditos / US$5 / créditos | US$0,008 / US$5 cada 1.000 / US$7 cada 1.000 |
| Búsqueda con datos de Google | **Gemini** con *grounding* en Google Search y Maps | — | por uso |
| Búsqueda general | Claude con búsqueda web | — | por uso |
| Navegar con otra app | **Waze** (deep link `waze.com/ul`) | gratis | — (no hay API de búsqueda para terceros) |

Pendiente verificar: condiciones de HERE para mostrar resultados sobre mapas OSM, y la licencia
comercial de Porcupine.

**Respaldo del modelo (LiteLLM, cadena de *fallbacks*):** Qwen3.8 en la Z440 → Qwen3 4B en la K16 →
un modelo en la nube con presupuesto (Claude o Gemini). La app no cambia: sigue llamando a la misma URL.
