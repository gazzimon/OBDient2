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

## Ideas para más adelante

- **Ángulo de volante por escucha del bus CAN** (`STM` + `STFPA`, en modo silencioso `STCMM 0`). En
  autos sin gateway, el volante, la velocidad de ruedas y el freno circulan por el HS-CAN a 50–100 Hz.
  Requiere decodificación propia de cada marca y filtrar 2–3 IDs por el límite de BLE.
- `STVR` en lugar de `ATRV` para leer el voltaje de batería (ambos funcionan).
- `STSN` como identificador estable del adaptador, mejor que la dirección BLE.
- J1939 (`STP 42`) para camiones de 24 V: el B33 lo anuncia.
