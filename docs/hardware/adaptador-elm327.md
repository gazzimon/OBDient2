# Adaptador OBD: ELM327 sin STN (B14)

Fuente: datasheet de Elm Electronics *"ELM327 — OBD to RS232 Interpreter"* (ELM327DSJ, firmware v2.1),
entregado como *"B14_V2.2 ELM327DS"*. Analizado el 2026-10-18. El PDF no se versiona aquí.

El B14 es, según el proveedor, Bluetooth LE 4.0. Si el firmware es un ELM327 genuino o un clon se sabe
recién en el banco: muchos clones dicen `ELM327 v1.5` o `v2.1` y solo implementan una parte.

## Qué ya funciona sin cambios

La app detecta el chip con `STI`. Un ELM327 contesta `?` y la sesión sigue por el camino ELM:

| Qué | ELM327 | Dónde |
|---|---|---|
| Identidad | `ATI` (`ELM327 v2.x`), `STI` → `?` | `data/obd/stn.ts` |
| Ajustes | `ATS0`, `ATAT1` (no `ATAT2`) | `stn.ts` |
| Velocidad | `010D1` (sufijo de cantidad de respuestas, desde v1.3) y `010D` | `telemetry-poller.ts` |
| Tensión | `ATRV` | `core/constants/pids.ts` |
| Protocolo | `ATWS` (con `ATZ` de respaldo), `ATE0`, `ATL0`, `ATFE`, `ATSP0`, `ATDP` | `data/adapters/protocol-manager.ts` |
| Errores | `NO DATA`, `CAN ERROR`, `BUFFER FULL`, `<DATA ERROR`, `<RX ERROR`, `LV RESET`, `ERR94`, `ERRxx`… | `transport-command-port.ts` |
| Respuesta pendiente | `7F xx 78`: espera 5 s y reenvía (máx. 2) | `transport-command-port.ts` |
| Bytes nulos | se descartan | `data/adapters/prompt-framer.ts` |
| Energía | `ATLP` al cerrar la sesión (solo si no es STN) | `data/obd/obd-session.ts` |

Formato de las respuestas: el mismo que el STN. Varios cuadros con `014` / `0:` / `1:` (CAF1), o con
encabezado y PCI con `ATH1` (§ *Multiline Responses*).

## Diferencias que importan

1. **Sin `STPX`**: la velocidad usa `010D1`. En el B35 dio el mismo rendimiento (el límite es BLE), así
   que no se espera pérdida.
2. **Respuesta pendiente `7F xx 78`**: solo la maneja el ELM327 **v2.1 o superior** (PP 2A bit 2). Un clon
   v1.5 devuelve `7F0478` y el prompt antes de la respuesta real: la app sigue esperando hasta 5 s
   (J1979) y, si no llega, reenvía el pedido (máx. 2). Afecta al borrado (`04`) y al freeze frame.
3. **Bytes nulos (`0x00`)**: el datasheet advierte que el chip puede intercalar alguno en la salida (§8,
   nota de Microchip). El lector de respuestas los descarta.
4. **`ERR94`** (error fatal de CAN): bloquea la búsqueda de protocolos CAN hasta apagar o hasta `ATFE`
   (PP 2A bit 5). `ATZ` no lo destraba. La app lo trata como reinicio del adaptador y la inicialización
   manda `ATFE`.
5. **`LV RESET`**: también bloquea la búsqueda CAN (PP 2A bit 4); la reinicialización de la sesión lo
   destraba.
6. **Energía**: con los valores de fábrica (PP 0E = 9A, PP 0F = D5) **el ELM327 no se duerme solo**, ni
   por falta de comandos ni por bus quieto (~30 mA el chip y su circuito, más el módulo Bluetooth).
   Enchufado de forma permanente descarga la batería. La app manda `ATLP` al cerrar la sesión. Si la app
   se cierra de golpe no llega a mandarlo: para el producto, PP 0F bit 5 (dormir tras 30 o 150 s sin
   actividad OBD) configurado en fábrica. Un ELM327 dormido descarta el primer comando: la
   inicialización lo cubre con el `ATZ` de respaldo.
7. **Reinicio**: `ATZ` tarda ~800 ms en el ELM327; `ATWS` hace lo mismo en ~2 ms sin la prueba de LEDs.
   La app usa `ATWS` y cae a `ATZ` si no contesta en 1,5 s.
8. **Búsqueda de protocolo**: `ATSP0` busca en cada conexión. Con el protocolo de cada auto guardado,
   `ATSP A7` (o `ATTP A7`) prueba primero ese y, si falla, busca. Sirve también para el STN.

## Capacidades comunes que vale aprovechar

- **Pedido de varios PIDs** (`01 0C 0D 05 …`, hasta 6, solo CAN): una respuesta por ciclo en lugar de
  seis (§ *Multiple PID Requests*). Base del muestreo rápido (M7) en los dos chips.
- **`ATH1` + `ATCRA`**: ver qué ECU responde y filtrar una sola.
- **Direccionamiento físico** (`ATSH 18DA10F1`, `ATCP`): igual que en el STN.

## Cómo distinguir genuino de clon

En el banco, además de `ATI`:
- `AT@1` → `OBDII to RS232 Interpreter` en el genuino (los clones suelen copiarlo).
- `ATAMC` (v2.0) y `ATCTM1` (v2.1): un clon que dice ser v2.x y contesta `?` no es genuino. Con eso se
  decide si confiar en la espera de `7F xx 78` del adaptador o hacerla en la app.

## No usar

`AT@3` (una sola escritura), `ATBRD`/`ATBRT` y PP 0C (velocidad serie; en Bluetooth es fija),
`ATPP 0D` (cambia el carácter de fin de comando y puede dejar el adaptador inutilizable), `ATCSM0` sin
estar seguro de la velocidad del bus, `ATBI`.
