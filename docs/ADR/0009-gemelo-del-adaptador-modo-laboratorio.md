# ADR-0009 — Gemelo del adaptador: modo laboratorio con OBDient como puente

**Estado:** propuesta · 2026-10-20 · se implementa **después de cerrar el ciclo de navegación**
(F1–F6 de [plans/modo-navegacion-ux.md](../plans/modo-navegacion-ux.md) y la voz en manejo).

## Contexto

M9 (diagnóstico del fabricante: ABS, airbag, caja, carrocería) necesita datos de cada marca:
direcciones de los módulos, si responden UDS (`19`, `22`) o KWP2000, identificadores de datos y sus
fórmulas. No están en fuentes abiertas confiables (revisado 2026-10-20: el repositorio
`automotive-claude-code-agents` trae datos genéricos correctos, pero scripts que inventan resultados y
relleno generado).

Las herramientas de taller que sí conocen esos datos (FORScan para Ford/Mazda/Lincoln; otras de PC que
usan adaptadores ELM/STN) corren en una computadora con el adaptador enchufado. Nuestro adaptador está
en el auto, conectado por Bluetooth a OBDient. Instalar esas herramientas en la Z440 no alcanza: no
llegan al auto. Además no tienen API: un MCP tendría que manejar su interfaz gráfica.

Uso: **laboratorio de la Fundación Iniciativa Urbana Inteligente**, sin fines comerciales; los datos
no se venden ni se distribuyen. La regla de **solo lectura** de M9 sigue vigente.

## Decisión

Un **gemelo digital del adaptador** en el servidor, con **OBDient como puente** hacia el adaptador real:

```
Herramienta de PC (FORScan en Wine, scripts UDS) ── COM ── puerto virtual (pty)
        │
   elm-twin (Z440): reenvía cada línea, registra todo, o responde desde lo grabado
        │  WebSocket con la clave de la cuenta (TLS, Caddy), como /tools/v1/stt
   obdient-tools (K16): relevo
        │
   OBDient (teléfono): filtro de solo lectura → sesión exclusiva → Bluetooth
        │
   STN / OBDLink real, en el auto
```

1. **Puente en vivo.** La herramienta de PC escribe en un puerto serie virtual; `elm-twin` manda cada
   línea por el relevo; OBDient la ejecuta en el adaptador real y devuelve la respuesta tal cual
   (incluido el `>`). La herramienta ve el STN real (`ATI`, `STI`, `STDI`). El ISO-TP y el control de
   flujo los hace el chip del adaptador: por la red viajan solo líneas cortas.
2. **Filtro en el teléfono, no en el servidor** (lista de permitidos, como M9):
   - UDS: solo `19`, `22`, `3E`, `10 01` y los modos OBD de lectura (`01`–`03`, `06`, `07`, `09`, `0A`).
   - Bloqueados: `2E`, `2F`, `31`, `34`–`37`, `3D`, `27`, `28`, `85`, `11`, `14`, modo `04`, `10 02`,
     `10 03`.
   - Adaptador: bloqueados `ATPP … SV`/`ON` (parámetros permanentes) y los cambios de velocidad del puerto
     (`ATBRD`, `STBR`, `STSBR`).
   - Un comando bloqueado se responde con un error de adaptador (`?`) y queda en el registro.
3. **Un dueño a la vez.** Con el puente activo, OBDient pausa su telemetría (`exclusive()`), muestra
   "Modo laboratorio: el servidor usa el adaptador" con un botón para cortar, y solo funciona con el
   auto detenido. Se enciende a mano (ajuste de Dev) y se apaga solo al moverse o tras 30 min sin uso.
4. **Registro.** `elm-twin` guarda cada comando y respuesta con hora y origen (JSONL, en la Z440). De
   ahí salen los **hechos** para M9 (qué módulos responden, en qué direcciones, qué identificadores
   lee la herramienta), que después OBDient lee solo, sin la herramienta.
5. **Modo réplica.** `elm-twin` responde desde un registro grabado, sin auto: herramientas, pruebas y el
   agente trabajan con "el auto de ayer" en la Z440.
6. **MCP.** Sobre el gemelo y su registro, herramientas de solo lectura para el agente (módulos, códigos,
   identificadores), con comandos que controlamos y registramos. No se automatiza la interfaz gráfica
   de terceros.

## Alternativas descartadas

- **FORScan/ODIS como servidor con MCP**: no llegan al auto, no tienen API; ODIS además exige la
  interfaz VAS y una cuenta de taller en línea.
- **Pass-thru J2534 por red**: el STN no es J2534 y las herramientas no lo esperarían.
- **Filtrar en el servidor**: el teléfono es el único punto por el que pasa todo hacia el auto; ahí
  la regla no se puede saltear desde otra herramienta.

## Consecuencias

- Más lento que el cable (cada comando ida y vuelta por la red celular, ~100–300 ms): aceptable para
  lecturas. A verificar si FORScan tolera la demora; si no, el gemelo responde la configuración inicial
  sin ir al auto.
- FORScan solo sirve con Ford/Mazda/Lincoln; para otras marcas el puente sirve a scripts UDS propios y a
  otras herramientas ELM/STN.
- El auto queda accesible desde la red solo con el modo encendido y la clave de la cuenta.
- El registro contiene datos del vehículo (VIN, códigos): queda en la Z440, no se publica.

## Orden de implementación (cuando se retome)

1. `elm-twin` con registro y **modo réplica** (no necesita el auto).
2. Relevo en `obdient-tools` y puente en OBDient con el **filtro** y sus pruebas.
3. Prueba con el B35 en el auto: OBDient ↔ gemelo ↔ un script UDS de lectura; luego FORScan en Wine
   si hay un Ford o Mazda.
4. MCP de solo lectura sobre el gemelo.
