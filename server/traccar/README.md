# Traccar — la web de seguimiento del laboratorio

Decisión 2026-10-20 (historial de viajes): posición en vivo de los autos de la Fundación en una web
propia, sin servicios de terceros. Traccar 6.16 en Docker en la K16.

```
OBDient (ajuste "Posición en vivo", apagado por defecto)
  → https://obdient.duckdns.org/tools/v1/track   (clave de la cuenta, obdient-tools)
  → 127.0.0.1:5055 (protocolo OsmAnd de Traccar, solo local)
Web: http://192.168.100.200:8082 (red local, no publicada en internet)
```

- Arranque: `cd server/traccar && docker compose up -d` (se reinicia solo).
- La **primera cuenta** que se crea en la web es la de administrador: crearla enseguida y después
  desactivar el registro libre en *Configuración → Servidor*.
- **Quién es quién** (decisión 2026-10-20):
  - **Dispositivo = el adaptador**: `obd_` + su dirección Bluetooth (mañana, su número de serie de
    fábrica). Se crea solo con su primera posición (`database.registerUnknown`); renombrarlo en la web.
  - **Auto = VIN**: va como atributo `vin` en cada posición (la app lo lee al conectar, `09 02`).
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
