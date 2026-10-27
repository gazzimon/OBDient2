# Herramienta de laboratorio `did_probe` (diseño)

2026-10-27 · Propuesta, sin código. Base: [ADR-0009](../ADR/0009-gemelo-del-adaptador-modo-laboratorio.md)
(modo laboratorio, solo lectura), `domain/obd/uds-safety.ts` (`classifyCommand`), `scan_modules` y
`obd_command` (`data/obd/vehicle-tool-adapter.ts`).

## Para qué

Hoy, cuando un `22 xxxx` no devuelve datos, no se sabe si falla el adaptador, si falla nuestro software o si
el DID simplemente no existe en ese módulo. La herramienta responde esa pregunta con evidencia, y de paso
descubre qué DIDs contesta un módulo. Solo lee.

## Qué hace: tres modos

| Modo | Qué manda | Para qué |
|---|---|---|
| `control` (por defecto) | `3E 00`, y `22 F190`, `F187`, `F189`, `F18C`, `F186` (identificación estándar, ISO 14229) | Decir si el camino adaptador–bus–módulo funciona. Es el primer paso de cualquier prueba |
| `list` | Una lista de DIDs dada (hasta 32): los que salgan de `knowledge_lookup`, `research` o un foro | Probar candidatos concretos |
| `scan` | `22 HHHH` en un rango (por defecto `F100`–`F1FF`; hasta 512 por llamada) | Descubrir qué contesta el módulo |

Todos trabajan sobre **un módulo por llamada** (el que dio `scan_modules`, o un header dado), un DID por
pedido: con un solo DID cada `7F` se atribuye sin ambigüedad.

## Cómo se interpreta cada respuesta

| Respuesta | Resultado | Qué dice |
|---|---|---|
| `62 HH HH …` | `supported` (guarda el largo) | El DID existe y se lee |
| `7F 22 31` | `unsupported` | El módulo respondió: ese DID no existe. Falta de información, no de hardware |
| `7F 22 33` | `locked` | Existe pero pide desbloqueo. **Nunca** se intenta desbloquear (`27` está fuera) |
| `7F 22 22` | `needs_conditions` | Existe, pero hoy no (sesión extendida, motor, velocidad). El B35 no maneja sesión: queda anotado |
| `7F 22 11` / `12` / `13` / `14` | `service_refused` / `format` | El servicio o el formato no los acepta: revisar el pedido |
| `7F 22 78` | espera | Pendiente; se espera hasta 5 s y se reintenta una vez |
| `NO DATA`, timeout, `?`, `BUFFER FULL`, `CAN ERROR` | `silent` | Nadie contestó: header, filtro, control de flujo o multi-trama. **Eso sí es hardware o software** |
| Respuesta con tramas faltantes | `incomplete` | El adaptador no reensambló; repetir con `STCSEGR 1` |

**Veredicto del módulo** (lo que lee el modelo y el usuario):
- `link_ok`: hubo al menos un `62` o un `7F` con el DID estándar. El adaptador y el software están bien;
  lo que falla es el DID.
- `link_silent`: ni `3E 00` ni `22 F190` contestaron. No es culpa del DID: revisar header (en 29 bits el
  pedido es `18DA<módulo>F1`; el `18DAF1<módulo>` es el de **respuesta**), `ATCRA`, control de flujo, o que el
  módulo viva en CAN FD (un ELM o un STN no lo ven).
- `link_partial`: el corto contesta y el multi-trama no (`incomplete`): es el adaptador, y la solución es
  `STCSEGR 1` o el B33-U.

## Seguridad (lo más importante)

La barrera es una lista permitida **más estrecha** que `classifyCommand` (que acepta `19`, `23`, `24`, `2A`):
en el teléfono solo pasan estos pedidos, y lo demás ni se envía.

- `22` con un DID de 2 bytes, y `3E 00`.
- Configuración del adaptador necesaria para direccionar (`ATSH`, `ATCRA`, `ATFC…`, `STCFCPA`, `STCSEGR`),
  la misma que ya valida `classifyCommand` (sin `ATPP…SV`, baudios ni guardado permanente).
- **Nunca**: `10` (ni `10 03`), `27`, `2E`, `2F`, `31`, `11`, `28`, `85`, `14`, `04`, `23`, `2A`.

Condiciones para correr, y para seguir corriendo:
1. **Auto detenido** (velocidad 0) y modo laboratorio activado; en movimiento se rechaza.
2. **Tensión ≥ 12,0 V** al empezar (`STVR`); si baja de 11,5 V se corta.
3. **Confirmación del usuario** antes de un `scan` o un `list` largo, como el borrado: módulo, cantidad de
   DIDs, duración estimada («~40 s») y «no escribe nada».
4. **Ritmo**: un pedido a la vez, con una pausa entre pedidos; si 10 seguidos quedan en `silent`, se corta
   (el módulo puede estar saturado).
5. **Tiempo**: máx. 60 s por llamada con la telemetría pausada, y un cursor para seguir en la próxima.
   Más de 512 DIDs o rangos fuera de `F100`–`F1FF` piden confirmar cada tramo.
6. **Códigos antes y después**: se leen los códigos (`03`) al empezar y al terminar; si aparece uno nuevo
   (algunos módulos registran un error de comunicación), el resultado lo dice.

Riesgo que queda: un fabricante puede haber puesto un efecto secundario detrás de un `22` (raro, contrario
a la norma). Por eso es solo con el auto detenido y siempre con confirmación en el barrido.

## Qué devuelve

Siguiendo la convención de las herramientas: `ok`, `summary` en español, y datos.

```
{ module: { id: "29:28", req: "18DA28F1", label: "ABS" },
  mode: "control", verdict: "link_ok",
  results: [{ did: "F190", outcome: "supported", length: 17 },
            { did: "F187", outcome: "unsupported", nrc: "31" }, …],
  dtcBefore: 2, dtcAfter: 2, elapsedMs: 3100, cursor: null }
```

Privacidad (ADR-0011): el VIN de `F190` llega enmascarado al modelo y **no** se guarda; en los DIDs de
identificación (`F18x`–`F19x`) solo se guarda el largo, no el valor. En el resto se guarda el largo y los
primeros bytes como muestra.

## Dónde vive

- `domain/obd/did-probe.ts` (puro): rangos, plan, clasificación de cada respuesta, reglas de corte y
  veredicto. Tests con tramas reales de la captura y de M7.0, no inventadas.
- `data/obd/vehicle-tool-adapter.ts`: ejecuta dentro de `exclusive()` con el mismo direccionamiento que
  `scan_modules` y la validación del header de 29 bits que le falta a `obd_command` (ver el plan de
  contexto, parte B8).
- `domain/assistant/tools.ts` y `policy.ts`: herramienta `did_probe`, `exclusive`, exige modo laboratorio,
  auto detenido y confirmación para `scan`/`list` largo.
- Servidor: lo que contesta cada módulo (marca, modelo, año, dirección, DID, resultado, largo) se suma a la
  base del laboratorio (`knowledge`), sin VIN, para que `knowledge_lookup` lo ofrezca a otros autos de la
  misma plataforma. Así el barrido de un auto sirve a todos.
- Eval: casos para `control` con módulo sano, módulo mudo y `7F 22 31`.

## Fases

1. ✅ (2026-10-27) `domain/obd/did-probe.ts` y sus tests (`__tests__/did-probe.test.ts`, 25). Sin tocar el auto.
2. Herramienta `did_probe` en modos `control` y `list`. Se prueba en la salida A (ver
   [pruebas-de-campo-m2-m5-m8.md](pruebas-de-campo-m2-m5-m8.md)), solo `control`.
3. Modo `scan` con confirmación y cursor.
4. Envío a la base del laboratorio y una nota en ADR-0009.

## Lo que no hace

No desbloquea (`27`), no cambia de sesión, no escribe ni activa nada, no lee memoria (`23`) y no importa
listas de DIDs de terceros: las listas se suman a mano a `list` después de revisar su licencia.

## Decisiones (2026-10-27)

1. **Confirmación en cada barrido**, decidida por el dueño. No hay confirmación única al activar el modo
   laboratorio.
2. **Rango por defecto `F100`–`F1FF`** (256 DIDs, ~15 s). Es el bloque que la norma reserva a la
   identificación y lo contestan todos los módulos UDS, así que sirve de control. Los rangos del fabricante
   (`0100`–`0FFF` y más) se barren después, por tramos de 512 con su confirmación, cuando el control ya
   salió bien en ese módulo y haya un motivo concreto (un DID candidato de una fuente, o una captura de
   la herramienta de referencia que acote el rango).
3. **Valores: largo siempre; muestra del valor solo fuera de la identificación.** En `F18x`–`F19x` (VIN,
   número de pieza, serie) se guarda solo el largo. En el resto se guardan el largo y hasta 8 bytes de
   muestra, pasados por `redactText` (si el valor contiene un VIN, se descarta la muestra). Sin la muestra
   no se puede averiguar qué es un DID (un odómetro se reconoce porque sube con los km); con ella, la
   base del laboratorio sirve de verdad.
