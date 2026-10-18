# Adaptador OBD: Starcharm B33 y la familia STN

Fuente: manual entregado por el proveedor, *"B35 — OBD Family Reference and Programming Manual (FRPM)"*,
revisión D (06-10-2020). Analizado el 2026-10-16. El PDF no se versiona aquí; pedirlo al proveedor.

## Qué es el manual

Es el manual público de **OBDLink / ScanTool.net** para sus chips STN, con la marca borrada:
- "OBDLink" aparece como "OBD".
- Los STN1110/1170/2100/2120 aparecen como "ARM1110/1170/2100/2120".

Tiene dos límites:
- **Describe una familia, no un dispositivo.** Qué protocolos y funciones tiene cada modelo lo dice su
  datasheet, que no tenemos. Lo que vale es lo que el adaptador responde: ver *Banco* más abajo.
- El archivo es del **B35**; el adaptador de referencia de OBDient2 es el **B33**. Se asume el mismo
  firmware hasta que el banco diga lo contrario.

## Lo que usamos y por qué

| Comando | Para qué | Dónde |
|---|---|---|
| `STI` | Detectar el chip STN. **Responde `STN…` o `ARM…`**: aceptamos ambos | `data/obd/stn.ts` |
| `ATS0` | Respuestas sin espacios: ~30 % menos bytes por BLE. El tokenizador acepta ambos formatos, incluso con varias ECUs | `stn.ts`, `core/utils/hexFrame.ts` |
| `ATAT2` | Timing adaptativo agresivo (solo si es STN; si no, `ATAT1`) | `stn.ts` |
| `STPX d:010D, r:1, t:100` | Pedir la velocidad indicando que esperamos **1 respuesta**: el chip contesta sin esperar su timeout (102 ms por defecto). Es la mayor ganancia de tasa | `data/obd/telemetry-poller.ts` |
| `010D1` | Lo mismo con el sufijo ELM327; respaldo en CAN si `STPX` falla | idem |

Cascada de estilos: `stpx` → `count` → `plain`. Un estilo se descarta para la sesión solo si uno más
lento funciona donde él falló, **dos veces**. Un NO DATA genuino no degrada nada.

## Errores y eventos del adaptador (§9)

- **No hay dato útil:** `BUFFER FULL`, `BUS BUSY`, `BUS ERROR`, `DATA ERROR`, `FB ERROR`,
  `FC RX TIMEOUT`, `OUT OF MEMORY`, `STOPPED`, `UART RX OVERFLOW`, además de los del ELM327.
- **Trama corrupta:** una respuesta con `<DATA ERROR` o `<RX ERROR` se descarta entera, aunque traiga
  bytes antes.
- **`ACT ALERT` / `LP ALERT`:** avisos de que el adaptador va a dormir; se filtran de las respuestas.
- **`LV RESET`:** el chip se reinició por bajo voltaje, típico al dar arranque. Pierde toda la
  configuración. La sesión lo detecta (con o sin comando en curso), reinicializa protocolo y ajustes, y
  reanuda la telemetría. El contador se ve en la pestaña Vehículo.

## Banco del adaptador

Pestaña **Vehículo → Banco del adaptador**, con el adaptador conectado. Pausa la telemetría unos
segundos y produce un informe en texto (se puede compartir):

1. **Identidad:** `ATI`, `AT@1`, `STI`, `STIX`, `STDI`, `STMFR`, `STSN`, `STPRS`, `STVR` y
   `STSLCS`, que muestra la configuración de ahorro de energía.
2. **Velocidad:** 20 lecturas del PID 0D con cada estilo disponible; Hz, ms por petición y éxitos.

Preguntas que responde en el primer uso:
- ¿Es realmente STN? ¿Qué chip y qué firmware?
- ¿Cuántos Hz de velocidad da `STPX` frente a `010D1` frente al estándar?
- ¿Se duerme solo si queda enchufado? En el `STSLCS`, mirar `UART SLEEP` y `VCHG WAKE`.

## Resultados de banco

### Starcharm B35, 2026-10-17 (auto con CAN 29 bits / 500 kbps, motor en marcha)

| | |
|---|---|
| Enlace | **Bluetooth LE**: conecta sin cambios en la app |
| `ATI` / `AT@1` | `ELM327 v1.5` / `OBD Scanner` |
| `STI` / `STIX` | `STN1040 v1.3.6` / `[2024.02.01]` |
| `STDI` / `STMFR` / `STSN` | `OBDII r3.1.3` / `OBD Scanner` / sin número de serie |
| `STPRS` | `AUTO, ISO 15765-4 (CAN 29/500)` |
| `STVR` | 14,53 V (alternador cargando) |
| `STSLCS` | Modo nativo; duerme con 600 s de inactividad o <13 V durante 3 h; despierta por actividad UART (conexión BLE). La respuesta llegó truncada: falta `VCHG WAKE` |
| Velocidad `STPX d:010D, r:1` | **24,2 Hz** (41 ms/pet, 20/20) |
| Velocidad `010D1` | 23,8 Hz (42 ms/pet, 20/20) |
| Velocidad `010D` | 15,0 Hz (66 ms/pet, 20/20) |

### Captura de diagnóstico, B35, 2026-10-18 (mismo auto, motor en marcha, sin códigos)

| Pedido | Respuesta | Lectura |
|---|---|---|
| ECU que responde | `18DAF111` (una sola) | El motor está en la dirección **11**, no en 10. La caja no contesta pedidos OBD |
| `0101` | `41 01 00 07 E1 00` | Luz de falla apagada, 0 códigos; monitores soportados: fallo de encendido, combustible, componentes, catalizador, sonda, calefactor de sonda, EGR/VVT; **todos completos** |
| `0131` | `41 31 08 95` | 2.197 km desde el último borrado |
| `03` / `07` / `0A` | `43 00` / `47 00` / `4A 00` | En CAN la respuesta trae **la cantidad de códigos** antes de la lista (aquí 0) |
| `0200`, `0202` | `NO DATA` | El freeze frame exige el **número de cuadro**: `020200` → `42 02 00 00 00` (sin freeze frame guardado) |
| `0900` | `49 00 55 40 02 00` | Soporta VIN (02), calibración (04), CVN (06), desempeño en uso (08), nombre de la ECU (0A) |
| `0902` | 3 cuadros (`10 14` + `21` + `22`) | VIN de 17 caracteres, armado bien con y sin encabezados |
| `STCSEGR 1` + `0902` (ATH0) | una sola línea con los 20 bytes | El STN arma el mensaje: sin línea de largo ni segmentos. El lector lo toma como cuadro único |
| `STP 34` + `0100` | `41 00 BE 1F B8 13` | El protocolo fijo funciona: base para guardar el protocolo por vehículo |
| `STVR` / `STDICES` / `STDITPO` / `STSLLT` | 14,32 V / 0 / 46007 / sin evento | `STDICES` no cuenta arranques en este adaptador |

El lector de tramas (M2.1) armó correctamente todas las respuestas. Falta verificar con códigos
guardados, con un freeze frame y con el B14.

Conclusiones:
- **El STN1040 no es un chip OBDLink** (no figura en la familia del manual): es firmware compatible
  del fabricante. Implementa lo que usamos (`STI`, `STPX`, `STSLCS`, `STVR`).
- `STPX` y el sufijo de conteo empatan: el límite es la latencia BLE (~40 ms), no el adaptador.
  Ganan un 60 % sobre la petición estándar.
- Con un PID secundario por ciclo, la velocidad al navegar queda en ~12 Hz: más del doble del
  objetivo del MVP.
- No drena la batería si queda enchufado.

## Funciones del manual que todavía no usamos

Revisión completa del FRPM, 2026-10-18. El B35 es un STN1040 que no figura en el manual: **cada comando
nuevo se prueba en el adaptador antes de depender de él** (captura del M2.0).

**Para el diagnóstico (M2):**
- **`ATH1` + `ATCAF1`**, la configuración que el manual recomienda (§7.2): muestra qué ECU responde
  (con CAN 29 bits, `18DAF110` motor, `18DAF118` caja). Las respuestas en varios cuadros pasan a traer
  el byte PCI (`10 14 …`, `21 …`): el parser tiene que entender ambos formatos.
- **`STCSEGR 1`**: el adaptador arma solo las respuestas en varios cuadros (§8.8). A probar.
- **`STPX` con `r:` y `t:`** también en diagnóstico: `r:` con la cantidad de ECUs medida, `t:` largo para
  `04` y freeze frame.
- **Respuesta pendiente `7F xx 78`**: PP 2A bit 2 (por defecto activo) hace que el adaptador espere.
  No es un rechazo.
- **`STVR`** (y `STVR 2`) en lugar de `ATRV`, y **`STPRS`** en lugar de `ATDP`: los dos AT están obsoletos
  en esta familia.

**Para el producto:**
- **Protocolo guardado por vehículo** con `STP 34` (ISO 15765, 29 bits, 500 k) en vez de buscar cada vez.
- **Energía (§15)**: fijarla en la preparación de fábrica, no desde la app (`STSLVG on`, `STSLVLS`).
  `STSLLT` dice por qué durmió o despertó.
- **`STDICES`** (arranques del motor) y **`STDITPO`** (tiempo encendido): a probar.
- **`STBTDN`**: nombre Bluetooth propio del producto. Requiere reiniciar el adaptador.

**Para más adelante:**
- **Diagnóstico del fabricante**: direccionamiento físico (`ATSH 18DA28F1`, `STCFCPA`) y UDS de solo
  lectura (`19`, `22`) para ABS, airbag, carrocería y caja. Nunca `2E`, `31` ni `14`.
- **Escucha pasiva del bus** (`STM` + `STFPA`, `STCMM 0`): volante, ruedas y freno a 50–100 Hz. Requiere
  decodificar cada marca y filtrar 2–3 IDs por el límite de BLE.
- **J1939** (`STP 42`) para camiones de 24 V.

**No usar:** `STSAVCAL`, `AT@3` y `STSDI` (una sola escritura), `STRSTNVM` (borra la configuración),
`STBR`/`STSBR`/`STWBR` (el puerto serie en Bluetooth es fijo), `STPPMA` (mensajes periódicos al bus).

Para adaptadores ELM327 sin STN: [adaptador-elm327.md](adaptador-elm327.md).
