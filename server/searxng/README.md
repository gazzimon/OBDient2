# SearXNG (prueba, 2026-10-19)

Buscador web propio para la futura herramienta `web_search` de `obdient-tools` (después de M6).
Corre en la K16, **solo en 127.0.0.1:8888**, sin pasar por Caddy. No está integrado a la app.

```bash
# Configuración (con su secret_key, fuera del repo, permisos 600)
~/.local/share/obdient/searxng/settings.yml   # use_default_settings, formats: [html, json], es-AR

docker run -d --name obdient-searxng --restart unless-stopped \
  -p 127.0.0.1:8888:8080 \
  -v ~/.local/share/obdient/searxng/settings.yml:/etc/searxng/settings.yml:ro \
  searxng/searxng:latest

curl -s "http://127.0.0.1:8888/search?format=json&language=es-AR&q=P0301" | head -c 500
docker stop obdient-searxng && docker rm obdient-searxng   # para quitarlo
```

Prueba (2026-10-19), 4 búsquedas: 28–30 resultados cada una en 1,2–1,7 s; respondieron Google
(CSE) y DuckDuckGo, Brave no. Talleres de Posadas con dirección en el fragmento (Páginas Amarillas,
Eurotaller), P0301 bien explicado, manual del Onix. Riesgo: los buscadores pueden limitar la IP con
mucho uso.

Para la herramienta: el modelo nunca recibe el texto de las páginas; `obdient-tools` extrae
direcciones, las valida con Photon y devuelve campos (ver docs/plans/voz-y-lugares.md §3).
