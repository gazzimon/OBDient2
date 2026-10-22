# OBDient frente a Gemini en el auto — benchmark 2026-10-22

Modelo: `obdient-chat` (Qwen3.8-27B INT4 en la Z440) · commit `d972c91` · 29 casos × 3 corridas.

## Qué mide y qué no

- Mide **OBDient** con el modelo real y **herramientas simuladas** (con las formas de resultado de las reales). Los segundos son los del modelo: no incluyen red ni GPS.
- **No mide a Gemini**: no se puede correr desde acá. La columna "Gemini" es lo que **Google anunció** (octubre de 2026) y de dónde saca los datos; la hoja del final trae los mismos pedidos para probarlos a mano.
- Los chequeos son reglas (sin modelo juez): revisar las transcripciones de `.json` antes de citar un número.
- Veredictos: **PASA** (correcto y bien dicho) · **PARCIAL** (correcto pero con algo que corregir) · **SIN CAPACIDAD** (no existe la herramienta, y fue honesto) · **FALLA** (se equivocó o **inventó**) · **ERROR** (falló el servidor).

## Resumen por bloque

| Bloque | Casos | PASA | PARCIAL | SIN CAPACIDAD | FALLA | ERROR | Seg. a la 1ª palabra | Seg. por turno | Palabras |
|---|---|---|---|---|---|---|---|---|---|
| A · Manejo | 10 | 93 % | 0 % | 0 % | 7 % | 0 % | 3.4 | 4.4 | 15 |
| B · El auto | 11 | 88 % | 0 % | 0 % | 12 % | 0 % | 3.4 | 7.6 | 63 |
| C · Memoria personal | 8 | 50 % | 0 % | 50 % | 0 % | 0 % | 1.5 | 4.6 | 26 |

**Memoria — honestidad:** en 24 de 24 corridas no inventó un lugar ni un dato (100 %). Es el riesgo que importa mientras no tengamos la capacidad: un destino inventado en un auto en marcha es peor que un "no sé".

## Detalle por caso

| Caso | Pedido | Resultado | 1ª palabra (s) | Por turno (s) | Palabras | Gemini lo anuncia | Datos que usa Google | Fallas más comunes |
|---|---|---|---|---|---|---|---|---|
| A1 | Llevame a Uruguay 1223 | PASA (3/3) | 1.4 | 5.5 | 16 | sí | Maps | — |
| A2 | ¿Cuánto falta para llegar? | PASA (3/3) | 3.3 | 3.9 | 10 | sí | Maps | — |
| A3 | ¿Dónde está la nafta más barata cerca? | PASA (3/3) | 3.8 | 6.4 | 44 | no lo menciona | Maps (estaciones); precios según el país | — |
| A4 | ¿Cuánto falta y va a llover cuando llegue? | PASA (3/3) | 3.8 | 4.6 | 15 | sí | razonar entre fuentes (el ejemplo del vuelo) | — |
| A5 | ¿A cuánto está el dólar blue y cuánto son 150 dólares en pesos? | PASA (3/3) | 4.4 | 5.4 | 19 | no lo menciona | búsqueda general | — |
| A6 | Llevame a una farmacia | PASA (3/3) | 6.1 | 7.0 | 16 | sí | Maps (lugares) | — |
| A7 | ¿Cuál es el próximo giro? | PASA (3/3) | 3.4 | 3.7 | 9 | sí | Maps | — |
| A8 | Cancelá la ruta | PASA (3/3) | 3.2 | 3.4 | 4 | sí | Maps | — |
| A9 | ¿Dónde estoy? | PASA (3/3) | 3.2 | 3.6 | 6 | sí | Maps | — |
| A10 | Llevame a la YPF más barata | FALLA (2/3) | 3.4 | 6.5 | 20 | sí | Maps (el ejemplo "a lo largo de mi ruta") | no llamó a set_destination con /"result":1\b/ (2×); no llamó a fuel_prices (1×) |
| B1 | Tengo el check engine prendido, ¿qué puede ser? | PASA (3/3) | 5.8 | 13.3 | 199 | no lo menciona | datos del vehículo (según el fabricante) | — |
| B2 | Tengo el P0171, ¿qué lo puede estar causando? | PASA (3/3) | 5.9 | 14.1 | 209 | no lo menciona | — | — |
| B3 | ¿Paso la VTV así como está? | FALLA (2/3) | 1.6 | 17.5 | 189 | no lo menciona | — | no llamó a read_readiness (2×); no dice el monitor EVAP incompleto (2×) |
| B4 | ¿Cuál es el historial de fallas de mi auto? | PASA (3/3) | 3.3 | 7.6 | 86 | no lo menciona | — | — |
| B5 | ¿Cuánto consume el auto ahora en ralentí? | PASA (3/3) | 3.8 | 4.6 | 17 | no lo menciona | datos del vehículo (según el fabricante) | — |
| B6 | ¿Qué módulos tiene mi auto? | PASA (3/3) | 1.4 | 9.0 | 63 | no lo menciona | — | — |
| B7 | ¿Cuándo cambié el aceite por última vez? | PASA (3/3) | 3.3 | 4.5 | 25 | no lo menciona | — | — |
| B8 | Anotá que hoy cambié el aceite a 45.000 km | PASA (3/3) | 1.4 | 4.8 | 22 | no lo menciona | — | — |
| B9 | ¿Qué DID me da el número de pieza del ABS en un Volkswagen? | PASA (3/3) | 1.4 | 8.2 | 62 | no lo menciona | — | — |
| B10 | ¿Tengo códigos? | PASA (3/3) | 3.8 | 6.7 | 73 | no lo menciona | — | — |
| B11 | ¿Todo bien con el motor? | FALLA (2/3) | 5.2 | 6.4 | 27 | no lo menciona | datos del vehículo (según el fabricante) | 27 palabras en movimiento (máx. 25) (1×); 28 palabras en movimiento (máx. 25) (1×) |
| C1 | Llevame adonde estuvimos ayer | SIN CAPACIDAD (3/3) | 3.6 | 4.4 | 21 | sí | memoria entre conversaciones / Maps | — |
| C2 | Llevame a la cafetería de la que hablamos ayer | PASA (3/3) | 6.0 | 7.1 | 19 | sí | memoria entre conversaciones | — |
| C8 | Llevame a la ferretería de la que hablamos ayer | PASA (3/3) | 3.6 | 4.6 | 26 | sí | memoria entre conversaciones | — |
| C3 | Llevame a mi taller de siempre | PASA (3/3) | 1.4 | 8.0 | 16 | sí | lugares guardados / memoria | — |
| C4 | Llevame a mi casa | SIN CAPACIDAD (3/3) | 1.4 | 1.7 | 10 | sí | lugares guardados (Maps) | — |
| C5 | ¿A qué hora es mi turno con el médico? | SIN CAPACIDAD (3/3) | 1.4 | 2.8 | 47 | sí | Calendario / Gmail | — |
| C6 | Encontrá el lavadero de la foto que saqué la semana pasada y llevame | SIN CAPACIDAD (3/3) | 3.6 | 5.1 | 40 | sí | Google Fotos | — |
| C7 | ¿Adónde iba y a qué? | PASA (3/3) | 1.5 | 2.5 | 28 | sí | memoria de la conversación | — |

## Brechas (lo que no pasa) y lo que costaría cerrarlas

- **A10 · combinar: "la YPF más barata" (busca, elige la YPF, pregunta)** — FALLA. Fallas: no llamó a set_destination con /"result":1\b/ (2×); no llamó a fuel_prices (1×).
- **B3 · ¿paso la VTV? (monitores)** — FALLA. Fallas: no llamó a read_readiness (2×); no dice el monitor EVAP incompleto (2×).
- **B11 · estado del motor en movimiento (corto)** — FALLA. Fallas: 27 palabras en movimiento (máx. 25) (1×); 28 palabras en movimiento (máx. 25) (1×).
- **C1 · "llevame adonde estuvimos ayer"** — SIN CAPACIDAD. Falta: memoria de lugares y viajes anteriores. Para cerrarla: no hay una fuente confiable: los viajes solo se graban con el OBD conectado (descartados, ADR-0010); haría falta un registro de los destinos a los que el usuario navega.
- **C4 · "llevame a mi casa"** — SIN CAPACIDAD. Falta: lugares guardados (casa, trabajo). Para cerrarla: guardar casa y trabajo en Ajustes y darle una herramienta para consultarlos.
- **C5 · "¿a qué hora es mi turno con el médico?"** — SIN CAPACIDAD. Falta: calendario y correo. Para cerrarla: permisos de Android y la aprobación de Google; no se hace sin acceso a la cuenta del usuario.
- **C6 · "el lavadero de la foto de la semana pasada"** — SIN CAPACIDAD. Falta: fotos anteriores. Para cerrarla: acceso a la galería del teléfono (permiso) y leer la ubicación de las fotos; la foto actual sí se puede mandar.

## Hoja de pruebas manuales: los mismos pedidos, para decírselos a Gemini

Decirlos tal cual, con el teléfono conectado al auto o a Android Auto, y anotar. "Correcto" = hizo lo que se pedía sin que el usuario tuviera que corregirlo.

| Caso | Decile a Gemini | ¿Lo hizo? | ¿Correcto? | Segundos | Notas |
|---|---|---|---|---|---|
| A1 | "Llevame a Uruguay 1223" → "Sí, dale" | | | | |
| A2 | "¿Cuánto falta para llegar?" | | | | |
| A3 | "¿Dónde está la nafta más barata cerca?" | | | | |
| A4 | "¿Cuánto falta y va a llover cuando llegue?" | | | | |
| A5 | "¿A cuánto está el dólar blue y cuánto son 150 dólares en pesos?" | | | | |
| A6 | "Llevame a una farmacia" | | | | |
| A7 | "¿Cuál es el próximo giro?" | | | | |
| A8 | "Cancelá la ruta" | | | | |
| A9 | "¿Dónde estoy?" | | | | |
| A10 | "Llevame a la YPF más barata" | | | | |
| B1 | "Tengo el check engine prendido, ¿qué puede ser?" | | | | |
| B2 | "Tengo el P0171, ¿qué lo puede estar causando?" | | | | |
| B3 | "¿Paso la VTV así como está?" | | | | |
| B4 | "¿Cuál es el historial de fallas de mi auto?" | | | | |
| B5 | "¿Cuánto consume el auto ahora en ralentí?" | | | | |
| B6 | "¿Qué módulos tiene mi auto?" | | | | |
| B7 | "¿Cuándo cambié el aceite por última vez?" | | | | |
| B8 | "Anotá que hoy cambié el aceite a 45.000 km" → "El Tracker" | | | | |
| B9 | "¿Qué DID me da el número de pieza del ABS en un Volkswagen?" | | | | |
| B10 | "¿Tengo códigos?" | | | | |
| B11 | "¿Todo bien con el motor?" | | | | |
| C1 | "Llevame adonde estuvimos ayer" | | | | |
| C2 | "Llevame a la cafetería de la que hablamos ayer" | | | | |
| C8 | "Llevame a la ferretería de la que hablamos ayer" | | | | |
| C3 | "Llevame a mi taller de siempre" | | | | |
| C4 | "Llevame a mi casa" | | | | |
| C5 | "¿A qué hora es mi turno con el médico?" | | | | |
| C6 | "Encontrá el lavadero de la foto que saqué la semana pasada y llevame" | | | | |
| C7 | "¿Adónde iba y a qué?" | | | | |

## Conclusión

Sacada de los números de arriba y de leer las transcripciones de cada caso que no pasó. Es la **segunda** medición del día: la primera mostró la brecha, esta mide lo que se hizo para cerrarla.

**1. Lo que cambió, medido.** Manejo 90 % → 93 % de PASA, el auto 76 % → 88 %, memoria 14 % → 50 % (con un caso nuevo, C8). Lo que se movió de verdad:
- **A6, "llevame a una farmacia": FALLA 3/3 → PASA 3/3.** Con la búsqueda web el asistente encuentra la dirección, la busca en el mapa, muestra el punto y pregunta "¿es ahí?". Ya no ofrece buscar algo que no puede hacer.
- **C2, "la cafetería de la que hablamos ayer": sin capacidad → PASA 3/3**, con `chat_search`.
- **C3, "mi taller de siempre": 0/3 → 3/3.** Ahora mira las notas del libro de service antes de pedir la dirección.
- **B6** (no pedir la marca) pasa 3/3 y **B8** lee el registro y ofrece los autos antes de preguntar.
- **Memoria: 24 de 24 corridas sin inventar un lugar ni un dato.** Cuando el historial no tiene nada (C8) lo dice y pide el dato.

**2. Dos fallas reales que aparecieron al medir, ya corregidas.** (a) **A6 se quedaba sin rondas:** el flujo web → buscar → mostrar → preguntar usa 4 llamadas al modelo, el máximo era 4 y, si una búsqueda no encontraba nada, salía con el texto de respaldo ("3 resultados de la web…"). Ahora el máximo es 5 y el prompt pide **una** dirección. (b) **C8 dijo "busqué en las conversaciones guardadas" sin llamar a la herramienta** en una corrida: no inventó un lugar, pero afirmó una acción que no hizo. Se agregó al prompt que la llame siempre y que nunca diga que buscó sin haberlo hecho; después pasó 3 de 3.

**3. Lo que sigue sin andar bien.**
- **A10, "la YPF más barata": inestable (3/3 → 2/3 → 1/3 en tres pasadas).** A veces pregunta qué combustible quiere antes de buscar, y a veces muestra la lista y pregunta sin mostrar el punto en el mapa. Con tres corridas no se distingue el ruido de una tendencia, y no se puede afirmar si baja por las ~550 tokens que sumó el prompt. Hay que repetirlo con más corridas antes de tocarlo.
- **B3, la VTV: 2 de 3 FALLA.** En dos corridas ni siquiera llamó a `read_readiness`, y omite el monitor EVAP incompleto.
- **B11, estado del motor en movimiento:** 27 a 28 palabras contra un límite de 25, en 2 de 3 corridas. Es un límite que fijamos nosotros; el contenido es correcto.
- **C1, C4, C5, C6 siguen "sin capacidad", a propósito.** C1 ("adonde estuvimos ayer") no tiene fuente confiable: los viajes solo se graban con el OBD conectado. C4 (casa) pide cargarla en Ajustes. C5 y C6 (turno médico, foto vieja) necesitan permisos de Android y la aprobación de Google.

**4. Contra los cinco ejemplos de Google.** Cubrimos "pedidos complejos en una sola respuesta" (A4) y ahora "la cafetería de ayer" (C2). No cubrimos: preferencias ("mi estilo"), el turno del médico (calendario), la foto del lavadero (fotos viejas; la foto actual sí se lee) ni lo de vuelo y puerta (Gmail, no se probó).

**Qué no se puede concluir.** (1) **No se midió a Gemini**: la columna de Google es lo que anunció, y la hoja de arriba es para probarlo a mano. (2) Las herramientas son simuladas y los segundos son del modelo, sin red ni GPS reales. (3) La "1ª palabra" puede ser un aviso antes de llamar herramientas: el tiempo que importa es el de "por turno". (4) Tres corridas muestran la dispersión, no dan estadística. (5) **Las mejoras están mezcladas con correcciones de mis propias reglas:** después de ver resultados corregí varias que daban fallas falsas (A1: la búsqueda simulada devolvía otra ciudad; B8: exigía un signo de pregunta y luego no reconocía "¿a cuál…?"; C1 y C8: no reconocían "no encontré" ni "contame"; C3: el simulado no tenía el taller en el mapa; B6: el VIN simulado no coincidía con el del barrido). Cada corrección está en el historial de git. Las mejoras de A6, C2 y C3 son del asistente; que B8 y C8 pasen depende en parte de reglas ajustadas.
