# Traccar — la web de seguimiento del laboratorio

Decisión 2026-10-20 (historial de viajes): posición en vivo de los autos de la Fundación en una web
propia, sin servicios de terceros. Traccar 6.16 en Docker en la K16.

```
OBDient (Ajustes → "Compartir mi recorrido con el laboratorio": solo si el conductor lo activó, ADR-0011)
  → https://obdient.duckdns.org/tools/v1/track   (clave de la cuenta, obdient-tools)
  → 127.0.0.1:5055 (protocolo OsmAnd de Traccar, solo local)
Web: http://192.168.100.200:8082 (red local, no publicada en internet)
```

- Arranque: `cd server/traccar && docker compose up -d` (se reinicia solo).
- La **primera cuenta** que se crea en la web es la de administrador: crearla enseguida y después
  desactivar el registro libre en *Configuración → Servidor*.
- **Quién es quién** (decisión 2026-10-20):
  - **Dispositivo = el adaptador, como seudónimo**: `obd_` + 16 caracteres hexadecimales de un SHA-256 de
    su dirección Bluetooth con una sal propia de cada instalación (la dirección no llega al servidor y el
    código no se puede volver a ella). Es estable: los viajes de un adaptador quedan juntos. Se crea solo
    con su primera posición (`database.registerUnknown`); renombrarlo en la web.
  - **Auto = los 11 primeros caracteres del VIN** (fabricante, línea, motor, año, planta), atributo `vin`.
    El serial de la unidad no se envía, y el servidor lo recorta aunque una app vieja lo mande.
  - **Conductor = correo de la cuenta**: lo pone el servidor (`driverUniqueId`), no la app.
    `obdient-auth` guarda en cada login la huella SHA-256 de la clave → correo
    (`~/.local/share/obdient/key-owners.json`, 600; nunca la clave). Para verlo con nombre en Traccar:
    *Configuración → Conductores*, uno por persona con el correo como identificador.
- Atributos que manda la app con cada posición: `rpm`, `coolant`, `load`, `voltage`, `fuelLph`
  (los que el adaptador leyó en los últimos 3 s).
- Traccar rechaza `-` en el identificador (400): solo letras, números y `_`.
- Memoria: Java limitado a 384 MB (la K16 anda justa). Base H2 en `data/` (fuera de git).
- Para verla fuera de la red local, más adelante: un subdominio o puerto propio en Caddy (Traccar no
  funciona bajo una subruta como `/traccar`).
