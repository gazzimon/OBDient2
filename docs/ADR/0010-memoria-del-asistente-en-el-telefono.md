# ADR-0010 — La memoria del asistente vive en el teléfono; sin Honcho por ahora

**Estado:** aceptada · 2026-10-22

## Contexto

El benchmark contra la "Personal Intelligence" de Gemini en el auto (`docs/benchmarks/2026-10-22-obdient-vs-gemini.md`)
mostró que la brecha más grande es la **memoria personal**: "la cafetería de la que hablamos ayer", "mi taller de
siempre", "adonde estuvimos ayer", "mi casa". Había que decidir de dónde sale esa memoria y quién la guarda.

## Decisión

1. **La memoria se arma con lo que ya está en el teléfono y se consulta con herramientas de solo lectura**: las
   conversaciones guardadas (`chat_search`) y el libro de service (`read_service_log`, donde queda el taller). Lo que se
   manda al modelo son pocas líneas de texto, sin coordenadas; para ir a un lugar se lo vuelve a buscar por su nombre.
2. **Los comercios por nombre se resuelven con la búsqueda web** (nombre y localidad → dirección → `search_place`),
   no con una base propia de lugares.
3. **No se usa Honcho (Plastic Labs) por ahora.**
4. **Los viajes no son fuente de lugares.** Solo se graban con la app abierta y el OBD conectado (decisión del
   2026-10-19), así que muchos recorridos no están: casa, trabajo o "adonde estuve" salían mal. Casa y trabajo quedan
   para más adelante, con una fuente explícita (que el usuario los cargue en Ajustes, o un registro de los destinos a
   los que navega).

## Por qué no Honcho

Honcho es una capa de memoria para agentes: guarda los mensajes por "peer" y sesión y, en segundo plano, un modelo
deduce conclusiones sobre la persona. Es AGPL-3.0, un servidor propio con Postgres y vectores, y necesita un modelo de
lenguaje para esa deducción. Para lo que hace falta hoy no encaja:

- Lo que se pidió es **buscar texto** y **leer un registro**: no hace falta que un modelo deduzca nada.
- **Mandaría las conversaciones al servidor.** Hoy quedan en el teléfono; sería cambiar la promesa de privacidad.
- Es **un servicio más** que operar, y sus llamadas al modelo compiten con el chat por la GPU que lo atiende.
- El criterio del proyecto es mantenerlo simple.

## Consecuencias

- Solo se recuerda lo que el teléfono conserva: las últimas conversaciones. Lo más viejo ya no está, y el asistente
  lo dice cuando no encuentra algo en vez de inventarlo (medido: en el benchmark nunca inventó un lugar).
- No hay "preferencias" aprendidas ("mi estilo"), ni calendario, correo o fotos: eso exige permisos de Android y, para
  el correo, la aprobación de Google.

## Cuándo revisarlo

Si se quiere **modelar preferencias de la persona entre dispositivos**, que es lo que Honcho hace bien, y siempre que
la privacidad de esos datos esté resuelta. También si la búsqueda por palabras en las conversaciones se queda corta y
hace falta buscar por significado: ahí alcanza con los vectores que el servidor ya tiene para sus textos, sin sumar otro
sistema.
