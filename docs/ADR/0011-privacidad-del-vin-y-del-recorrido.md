# ADR-0011 — El VIN y el recorrido no salen del teléfono con la identidad del auto

**Estado:** aceptada · 2026-10-25

## Contexto

Un chat de prueba (2026-10-21) mostró que el VIN del auto del laboratorio estaba al alcance de cualquiera:

- La captura de diagnóstico y la exportación del chat, pensadas para compartir, llevaban la respuesta cruda del
  modo 09 02 (el VIN en hexadecimal) y todas las coordenadas y la ciudad.
- El asistente lo anunció en pantalla, y **mal**: un VIN escrito por un modelo de lenguaje se inventa.
- La base de conocimiento del laboratorio, común a todos los usuarios, guardaba una lista de VIN por modelo y se la
  devolvía a cualquiera que preguntara por la misma marca y modelo (también dentro de un número de parte: el DID
  F190 es el VIN).
- El seguimiento en vivo mandaba a Traccar el VIN completo, la dirección Bluetooth del adaptador y la cuenta,
  siempre y sin pedir permiso (decisión del 2026-10-20), lo que contradice ADR-0008 §5.

El VIN nombra a **un** auto y, con la cuenta, a su dueño. Sus primeros 11 caracteres dicen qué auto es (fabricante,
línea, motor, año, planta) y alcanzan para el laboratorio; los últimos 6 son el serial de esa unidad.

## Decisión

1. **El dueño ve su VIN completo en su teléfono; nada que salga de él, ni nada que vea otro usuario, lleva el serial.**
   Se muestra el VIN con el serial tapado (`8AGEA76C0RR••••••`).
2. **Un único módulo** (`domain/privacy`) hace el enmascarado, y todo lo que sale pasa por él: la captura de
   diagnóstico, lo que se comparte, la exportación del chat, lo que lee el modelo y lo que se sube al laboratorio.
   Cubre el VIN escrito, la respuesta en bytes (`49 02 01 …`, `62 F1 90 …`) y los bytes del serial dentro de un
   volcado de tramas; además la dirección del adaptador, el correo y las posiciones precisas (a ~1 km).
3. **El modelo nunca recibe el serial.** El historial del teléfono conserva lo que vio el dueño; la petición al modelo
   se arma enmascarada, y el prompt le indica que no lo complete ni lo invente.
4. **La base común del laboratorio no guarda ni devuelve VIN.** Un VIN dentro de un número de parte o de una nota se
   enmascara, y un archivo anterior se limpia al arrancar el servidor.
5. **El seguimiento en vivo requiere un sí explícito del conductor** (Ajustes) y manda seudónimos: el dispositivo y el
   auto no se identifican por la dirección del adaptador ni por el VIN, sino por un código derivado con una sal
   aleatoria propia de cada instalación. Es estable (el laboratorio sigue la historia de un auto) pero no se puede
   volver al VIN probando VIN. Del VIN se envían solo los 11 primeros caracteres.

## Consecuencias

- El asistente ya no puede "decir el VIN completo" a pedido: dice qué auto es y que el resto está tapado. La
  evaluación (`scripts/assistant-eval.ts`) se ajustó a eso.
- Un teléfono que ya enviaba el seguimiento deja de hacerlo hasta que su dueño lo active en Ajustes.
- Un serial partido entre dos tramas de un volcado no se detecta por sí solo; se cubre porque la captura de la app
  conoce el VIN que leyó. Un volcado ajeno pegado a mano puede dejar pasar un serial así.
- El VIN real del auto del laboratorio queda en el historial de git. Reescribir el historial es destructivo y se
  decide aparte.
- Pendiente: la política de privacidad y la pantalla de aviso de ubicación antes de Google Play (`docs/ROADMAP.md`).
