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

## Voz a texto (M6): `/tools/v1/stt` (WebSocket)

El teléfono manda PCM16 a 16 kHz en base64 y recibe texto parcial y final. `obdient-tools` hace el
saludo con vLLM, agrega su clave y solo deja pasar audio y el cierre. Límites: la clave de la cuenta,
2 sesiones a la vez por cuenta, 90 s por sesión, 64 KB por mensaje.

```bash
# K16: dónde está Voxtral y su clave (la de vLLM, VLLM_API_KEY de ~/obdient-stack/.env en la Z440)
cat >> ~/.config/obdient/tools.env <<'X'
STT_URL=ws://192.168.100.210:8002/v1/realtime
STT_API_KEY=<pegar la clave acá>
X
chmod 600 ~/.config/obdient/tools.env && systemctl --user restart obdient-tools
```
