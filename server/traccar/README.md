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
- Cada teléfono es un dispositivo `obd_xxxxxxxx` (lo muestra Ajustes en la app) y se crea solo con su
  primera posición (`database.registerUnknown`). El administrador lo ve y lo puede renombrar
  ("Gol de Juan").
- Atributos que manda la app con cada posición: `rpm`, `coolant`, `load`, `voltage`, `fuelLph`
  (los que el adaptador leyó en los últimos 3 s).
- Traccar rechaza `-` en el identificador (400): solo letras, números y `_`.
- Memoria: Java limitado a 384 MB (la K16 anda justa). Base H2 en `data/` (fuera de git).
- Para verla fuera de la red local, más adelante: un subdominio o puerto propio en Caddy (Traccar no
  funciona bajo una subruta como `/traccar`).
