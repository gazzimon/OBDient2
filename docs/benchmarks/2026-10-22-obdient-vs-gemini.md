# OBDient frente a Gemini en el auto — benchmark 2026-10-22

Modelo: `obdient-chat` (Qwen3.8-27B INT4 en la Z440) · commit `13dca35` · 28 casos × 3 corridas.

## Qué mide y qué no

- Mide **OBDient** con el modelo real y **herramientas simuladas** (con las formas de resultado de las reales). Los segundos son los del modelo: no incluyen red ni GPS.
- **No mide a Gemini**: no se puede correr desde acá. La columna "Gemini" es lo que **Google anunció** (octubre de 2026) y de dónde saca los datos; la hoja del final trae los mismos pedidos para probarlos a mano.
- Los chequeos son reglas (sin modelo juez): revisar las transcripciones de `.json` antes de citar un número.
- Veredictos: **PASA** (correcto y bien dicho) · **PARCIAL** (correcto pero con algo que corregir) · **SIN CAPACIDAD** (no existe la herramienta, y fue honesto) · **FALLA** (se equivocó o **inventó**) · **ERROR** (falló el servidor).

## Resumen por bloque

| Bloque | Casos | PASA | PARCIAL | SIN CAPACIDAD | FALLA | ERROR | Seg. a la 1ª palabra | Seg. por turno | Palabras |
|---|---|---|---|---|---|---|---|---|---|
| A · Manejo | 10 | 90 % | 0 % | 0 % | 10 % | 0 % | 2.4 | 3.8 | 19 |
| B · El auto | 11 | 76 % | 9 % | 0 % | 15 % | 0 % | 2.9 | 6.7 | 69 |
| C · Memoria personal | 7 | 14 % | 14 % | 71 % | 0 % | 0 % | 1.0 | 1.7 | 23 |

**Memoria — honestidad:** en 21 de 21 corridas no inventó un lugar ni un dato (100 %). Es el riesgo que importa mientras no tengamos la capacidad: un destino inventado en un auto en marcha es peor que un "no sé".

## Detalle por caso

| Caso | Pedido | Resultado | 1ª palabra (s) | Por turno (s) | Palabras | Gemini lo anuncia | Datos que usa Google | Fallas más comunes |
|---|---|---|---|---|---|---|---|---|
| A1 | Llevame a Uruguay 1223 | PASA (3/3) | 2.9 | 5.9 | 16 | sí | Maps | — |
| A2 | ¿Cuánto falta para llegar? | PASA (3/3) | 2.4 | 3.0 | 12 | sí | Maps | — |
| A3 | ¿Dónde está la nafta más barata cerca? | PASA (3/3) | 2.9 | 5.2 | 44 | no lo menciona | Maps (estaciones); precios según el país | — |
| A4 | ¿Cuánto falta y va a llover cuando llegue? | PASA (3/3) | 2.9 | 3.9 | 23 | sí | razonar entre fuentes (el ejemplo del vuelo) | — |
| A5 | ¿A cuánto está el dólar blue y cuánto son 150 dólares en pesos? | PASA (3/3) | 4.5 | 5.5 | 19 | no lo menciona | búsqueda general | — |
| A6 | Llevame a una farmacia | FALLA (3/3) | 1.0 | 3.6 | 27 | sí | Maps (lugares) | 29 palabras en movimiento (máx. 25) (1×); no dice que pida la dirección (1×) |
| A7 | ¿Cuál es el próximo giro? | PASA (3/3) | 2.4 | 2.8 | 9 | sí | Maps | — |
| A8 | Cancelá la ruta | PASA (3/3) | 2.3 | 2.5 | 5 | sí | Maps | — |
| A9 | ¿Dónde estoy? | PASA (3/3) | 2.4 | 2.7 | 7 | sí | Maps | — |
| A10 | Llevame a la YPF más barata | PASA (3/3) | 1.0 | 7.6 | 25 | sí | Maps (el ejemplo "a lo largo de mi ruta") | — |
| B1 | Tengo el check engine prendido, ¿qué puede ser? | PASA (3/3) | 6.8 | 13.5 | 157 | no lo menciona | datos del vehículo (según el fabricante) | — |
| B2 | Tengo el P0171, ¿qué lo puede estar causando? | PASA (3/3) | 5.9 | 14.0 | 212 | no lo menciona | — | — |
| B3 | ¿Paso la VTV así como está? | FALLA (3/3) | 1.0 | 14.5 | 186 | no lo menciona | — | no dice el monitor EVAP incompleto (3×) |
| B4 | ¿Cuál es el historial de fallas de mi auto? | PASA (3/3) | 1.0 | 8.1 | 90 | no lo menciona | — | — |
| B5 | ¿Cuánto consume el auto ahora en ralentí? | PASA (3/3) | 2.9 | 3.6 | 16 | no lo menciona | datos del vehículo (según el fabricante) | — |
| B6 | ¿Qué módulos tiene mi auto? | PASA (2/3) | 1.0 | 10.5 | 80 | no lo menciona | — | no llamó a scan_modules (1×); no dice el módulo de frenos (1×) |
| B7 | ¿Cuándo cambié el aceite por última vez? | PASA (3/3) | 2.5 | 3.6 | 27 | no lo menciona | — | — |
| B8 | Anotá que hoy cambié el aceite a 45.000 km | PARCIAL (3/3) | 3.6 | 4.4 | 16 | no lo menciona | — | no dice que ofrezca los autos del registro (3×) |
| B9 | ¿Qué DID me da el número de pieza del ABS en un Volkswagen? | PASA (3/3) | 7.7 | 10.8 | 69 | no lo menciona | — | — |
| B10 | ¿Tengo códigos? | PASA (3/3) | 3.0 | 6.3 | 80 | no lo menciona | — | — |
| B11 | ¿Todo bien con el motor? | PASA (2/3) | 4.2 | 5.1 | 24 | no lo menciona | datos del vehículo (según el fabricante) | 27 palabras en movimiento (máx. 25) (1×) |
| C1 | Llevame adonde estuvimos ayer | SIN CAPACIDAD (3/3) | 1.0 | 1.7 | 22 | sí | memoria entre conversaciones / Maps | — |
| C2 | Llevame a la cafetería de la que hablamos ayer | SIN CAPACIDAD (3/3) | 1.0 | 2.0 | 30 | sí | memoria entre conversaciones | — |
| C3 | Llevame a mi taller de siempre | PARCIAL (3/3) | 1.0 | 1.5 | 15 | sí | lugares guardados / memoria | no llamó a read_service_log (3×); no dice el taller Gómez del libro (3×) |
| C4 | Llevame a mi casa | SIN CAPACIDAD (3/3) | 1.0 | 1.5 | 15 | sí | lugares guardados (Maps) | — |
| C5 | ¿A qué hora es mi turno con el médico? | SIN CAPACIDAD (3/3) | 1.0 | 2.5 | 48 | sí | Calendario / Gmail | — |
| C6 | Encontrá el lavadero de la foto que saqué la semana pasada y llevame | SIN CAPACIDAD (3/3) | 1.0 | 1.7 | 22 | sí | Google Fotos | — |
| C7 | ¿Adónde iba y a qué? | PASA (3/3) | 1.1 | 2.0 | 28 | sí | memoria de la conversación | — |

## Brechas (lo que no pasa) y lo que costaría cerrarlas

- **A6 · un comercio ("una farmacia"): sin lugares por nombre todavía** — FALLA. Falta: lugares y comercios por nombre. Para cerrarla: un buscador de lugares (POI) en el servidor de mapas; hoy solo se navega por dirección.
- **B3 · ¿paso la VTV? (monitores)** — FALLA. Fallas: no dice el monitor EVAP incompleto (3×).
- **B8 · anotar un service: pregunta de qué auto antes de guardar** — PARCIAL. Fallas: no dice que ofrezca los autos del registro (3×).
- **C1 · "llevame adonde estuvimos ayer"** — SIN CAPACIDAD. Falta: memoria de lugares y viajes anteriores. Para cerrarla: exponer el historial de viajes (ya se guarda en el teléfono) como herramienta de solo lectura.
- **C2 · "la cafetería de la que hablamos ayer"** — SIN CAPACIDAD. Falta: memoria entre conversaciones. Para cerrarla: buscar en las conversaciones guardadas (ya hay buscador en el historial) con una herramienta.
- **C3 · "mi taller de siempre" (existe en el libro de service)** — PARCIAL. Fallas: no llamó a read_service_log (3×); no dice el taller Gómez del libro (3×).
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
| C3 | "Llevame a mi taller de siempre" | | | | |
| C4 | "Llevame a mi casa" | | | | |
| C5 | "¿A qué hora es mi turno con el médico?" | | | | |
| C6 | "Encontrá el lavadero de la foto que saqué la semana pasada y llevame" | | | | |
| C7 | "¿Adónde iba y a qué?" | | | | |

## Conclusión

Sacada de los números de arriba y de leer las transcripciones de cada caso que no pasó.

**1. Manejo: está al nivel de lo que Google anuncia, salvo en comercios.** 9 de los 10 casos pasan 3 de 3, incluidos los dos que copian los ejemplos de Google: una respuesta con dos fuentes (A4: cuánto falta + si llueve al llegar) y componer pasos (A10: "la YPF más barata" → busca, elige la YPF, pregunta antes de arrancar). El único que falla es A6 ("una farmacia"): no existe un buscador de lugares por nombre, y en una de las tres corridas el asistente **ofreció buscar una farmacia cercana, algo que no puede hacer**. Eso es una promesa falsa, más grave que el límite en sí.

**2. El auto: es donde está la diferencia, pero tiene fallas propias.** Pasan 25 de 33 corridas (76 %). Las fallas son reales: (a) B3, VTV: dice con razón que no pase (testigo encendido) pero **omite el monitor EVAP incompleto en las 3 corridas**; (b) B6: en una corrida **preguntó la marca y el modelo** antes de barrer, aunque el VIN ya la da; (c) B8: pregunta de qué auto se trata, pero **nunca ofrece los autos del libro de service** (3 de 3); (d) B11: 27 palabras en movimiento (límite 25). Las respuestas son largas (B1 a B3: 157 a 212 palabras, 13 a 14 s por turno por usar 4 o 5 herramientas): bien detenido, inaplicable en movimiento.

**3. Memoria: no puede, pero no inventa.** 15 de 21 corridas son "SIN CAPACIDAD" (ayer, la cafetería, casa, turno médico, foto vieja) y **en 21 de 21 no inventó un lugar ni una hora**: dijo que no tiene el dato y pidió la dirección. Eso importa: es el riesgo real mientras no exista la capacidad. Retomar lo dicho **dentro de la misma conversación** pasa 3 de 3 (C7). **C3 es el hallazgo más barato:** "mi taller de siempre" está en el libro de service (la nota del cambio de aceite lo trae) y el asistente **nunca lo miró (0 de 3)**; dijo "no tengo guardada la dirección". Y C6 es medio caso: no ve fotos viejas, pero pidió que se la adjunten, y la foto actual sí la lee.

**4. Contra los cinco ejemplos de Google.** Con la caja de herramientas actual cubrimos: "pedidos complejos en una sola respuesta" (A4). No cubrimos: preferencias ("mi estilo"), el turno del médico (calendario), la foto del lavadero (fotos) y la cafetería de ayer (memoria entre conversaciones). Lo de vuelo y puerta de embarque (Gmail) no se probó: no hay herramienta. De las brechas de memoria, **tres se pueden cerrar con datos que el teléfono ya tiene** (viajes → C1, conversaciones guardadas → C2, libro de service → C3) y una con datos que se guardan en Ajustes (casa y trabajo → C4). Calendario y fotos (C5, C6) necesitan permisos de Android y, para el correo, la aprobación de Google.

**5. Qué conviene hacer primero** (de menor a mayor costo): (a) tres líneas del prompt que arreglan C3, B6 y B8, y una regla "nunca ofrezcas buscar lugares por nombre" para A6; (b) herramientas de solo lectura sobre el historial de viajes y las conversaciones (C1, C2); (c) casa y trabajo guardados (C4); (d) un buscador de lugares (A6, el más caro).

**Qué no se puede concluir de esto.** (1) **No se midió a Gemini**: la columna de Google es lo que anunció, y la hoja de arriba es para probarlo a mano. (2) Las herramientas son simuladas, y los segundos son del modelo, sin red ni GPS reales. (3) La "1ª palabra" puede ser un aviso antes de llamar herramientas ("voy a revisar…"), no la respuesta: el tiempo que importa es el de "por turno". (4) Tres corridas por caso dan una idea de la dispersión, no una estadística. (5) Después de la primera corrida **corregí dos reglas mías** que daban fallas falsas: A1 (la búsqueda simulada devolvía Buenos Aires con el usuario en Posadas) y B8 (exigía un signo de pregunta que no hacía falta). Esos dos casos se repitieron; el resto es la primera corrida.
