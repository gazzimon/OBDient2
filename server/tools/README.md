# obdient-tools (M8)

Herramientas del asistente que necesitan internet o datos del servidor. Corre en la K16, en
`127.0.0.1:8791`, detrás de Caddy en `/tools`. Solo con la clave de una cuenta (new-api la valida).
No registra claves, consultas ni posiciones.

| Ruta (`POST /tools/v1/…`) | Datos | Fuente |
|---|---|---|
| `web_search { query }` | 5 resultados: título, sitio, fragmento ≤ 180, direcciones y precios encontrados | SearXNG local ([../searxng](../searxng/README.md)) |
| `fuel { lat, lng, product? }` | 5 estaciones más cercanas (≤ 30 km) con precio y antigüedad; la más barata a ≤ 10 km | Secretaría de Energía, Res. 314/2016 (datos abiertos), **diario** |
| `dollar {}` | oficial, blue, MEP, CCL, mayorista, cripto, tarjeta | dolarapi.com (no oficial), **diario** |
| `weather { lat, lng }` | ahora y próximas 6 h | Open-Meteo, en el momento |
| `car_price { query, year? }` | versiones que coinciden, precio por año (miles de pesos) | Lista de la CCA (PDF público), **mensual** |

Precios de combustible: desde la desregulación de 2025 muchas estaciones dejaron de informar
(2026-10-19: 4.115 estaciones, 944 con precio de los últimos 90 días). Se guardan todas como lugar y el
precio solo si es reciente, con su antigüedad.

## Instalar (systemd --user, sin sudo)

```bash
cp server/tools/obdient-tools.service server/tools/systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now obdient-tools obdient-tools-daily.timer obdient-tools-monthly.timer
node server/tools/src/jobs.mjs daily && node server/tools/src/jobs.mjs monthly   # primera carga
systemctl --user list-timers | grep obdient
journalctl --user -u obdient-tools-daily -n 20
```

Datos en `~/.local/share/obdient/tools/{fuel,dollar,cars}.json`. Si una fuente falla, queda el
archivo anterior. La mensual necesita `pdftotext` (poppler-utils).
