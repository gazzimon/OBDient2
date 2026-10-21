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

## M9 multi-marca — por implementar próximamente (2026-10-20)

Base ya hecha (commit 476a240): `scan_modules` (barrido por lista 11/29 bits + `22 F190`),
`obd_command` (lectura libre con clasificador), base de hechos del laboratorio, `web_fetch`,
`knowledge_lookup`. Falta, para correr varias marcas:

1. **Barrido por difusión funcional**: una sola petición a `7DF` (11 bits) o `18DB33F1` (29 bits) y
   responden todos los módulos del bus a la vez — descubre módulos que no están en ninguna lista,
   sin importar la marca. Es la mejora #1 para multi-marca. (Confirmado en openxc/uds-c:
   `OBD2_FUNCTIONAL_BROADCAST_ID = 0x7DF`.)
2. **Barrido en los tres buses del B35** (HS-CAN, MS-CAN, SW-CAN — el B35 los soporta como el OBDLink
   MX+): conmutar de bus con el comando ST del STN (confirmar el exacto en la STN FRPM de scantool.net),
   barrer cada uno, y **volver a HS-CAN al terminar**.
3. **Identificar y guardar**: cada módulo que responde se identifica con `22 F190` (y DIDs de parte/
   software) y se guarda en la base del laboratorio con **marca, bus y dirección**.

**Normas de referencia:** ISO 15765-4 (direccionamiento y difusión 7DF/18DB33F1), ISO 15765-2 (ISO-TP,
control de flujo), ISO 14229-1/-3 (UDS), ISO 15031 / SAE J1979 (OBD), SAE J2012 (códigos),
ISO 11898-1/-2/-3 y SAE J2411 (HS/MS/SW-CAN), y la **STN FRPM** (comandos ST de conmutación de bus).

**Bibliotecas evaluadas (2026-10-20) — ninguna corre en el teléfono (TS); son del servidor o referencia:**
- **commaai/opendbc** (Python, MIT, activo): la más valiosa. Su `fw_versions`/`FW_QUERY_CONFIG` trae
  **direcciones de módulos y DIDs de fingerprint por auto y marca** — fuente para sembrar la base. Sus
  consultas UDS + ISO-TP, de referencia.
- **pylessard/python-udsoncan** (Python, MIT, maduro): cliente UDS de referencia para el gemelo/réplica
  en el servidor.
- **mdabrowski1990/uds** (Python, MIT, activo): UDS sobre CAN/Ethernet/LIN/FlexRay/K-Line; alternativa a
  udsoncan con K-Line (autos viejos).
- **openxc/uds-c** (C, BSD-3, sin cambios desde 2021): UDS/OBD embebido con shims; referencia de la
  máquina de estados y del broadcast, no dependencia (iría en firmware, no en TS/Node).
- **kingjosephm/uds-diagnostic-tool** (Python, **sin licencia**, LLM+LangGraph sobre un PCAP): analiza
  capturas con un agente; **no se puede reusar** (sin licencia) y no habla con el auto. Solo inspira el
  flujo "analizar una captura", que nuestro agente ya hace en vivo.

## Respuestas del proveedor sobre los adaptadores (2026-10-20)

- **B14:** HS-CAN + MS-CAN (sin SW-CAN).
- **B33-U:** set de comandos UDS propio (AT UDS/UDST/**UR**/**URH**/USID/RSID/**UDSF**/UDSN/UDSD).
  El **firmware hace ISO-TP, timeouts y control de flujo** por dentro. `AT URH <TX> <RX> hh…` envía una
  petición UDS a direcciones arbitrarias y devuelve la respuesta **reensamblada**; `AT UDSF1` = difusión
  funcional (7DF); `AT UDST xx` = P2/P2* en ms; `AT UDSN` = último NRC; `AT UDSD` = volcado completo. El
  formato de respuesta es "sugerido" en el datasheet → **verificar en hardware**. Es el adaptador ideal
  para M9.
- **STN (B14/B35), respuestas del proveedor:**
  1. **Cualquier módulo** es accesible configurando TX ID y filtro RX (ATSH/ATCRA). Sin restricción al ECM
     ni a los IDs funcionales de OBD. → valida nuestro barrido.
  2. **No reensambla multi-trama automáticamente**: las tramas pasan una por una. → la **presencia** de un
     módulo se detecta igual (3E 00 es una sola trama; un 7F..78 ya cuenta como presente), pero el
     **número de pieza (22 F190, multi-trama) puede venir incompleto** en B14/B35. Lectura profunda
     multi-trama: con el B33-U (lo hace el firmware) o con control de flujo manual.
  3. **Sin manejo de sesión**; ATST máximo 1 s. → nuestro barrido usa la sesión por defecto (no `10 03`),
     así que no le afecta. Diagnóstico que necesite sesión extendida: solo con el B33-U o aparte.
  4. **NRC 0x78 (responsePending) pasa tal cual**, el adaptador no espera. → ya lo cubre
     `data/adapters/transport-command-port.ts`: el host espera hasta 5 s y reintenta (PENDING_FRAME).

**Conclusión:** el barrido multi-bus actual sirve para **descubrir qué módulos existen** en B14/B35. Para
**leer a fondo** (números de pieza completos, datos del `22`), el camino es el **B33-U con `AT URH`**, que
conviene implementar como ruta preferida cuando el adaptador es un B33-U (perfil `uds: 'at-ur'` ya
existe), verificando el formato de respuesta real.
