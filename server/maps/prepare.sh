#!/usr/bin/env bash
# Prepara los datos de rutas (OSRM) y búsqueda (Photon) para Argentina en la Z440.
# Idempotente: se puede volver a correr para actualizar los mapas (p. ej. una vez al mes).
#   ~/obdient-stack/maps/osrm/    argentina-latest.osrm* (perfil auto, algoritmo MLD)
#   ~/obdient-stack/maps/photon/  photon.jar + photon_data/
# Uso: systemd-run --user --unit=obdient-maps --working-directory=$HOME/obdient-stack/maps \
#        bash -c 'bash prepare.sh > prepare.log 2>&1'
set -euo pipefail
BASE=${BASE:-$HOME/obdient-stack/maps}
# La etiqueta sin sufijo no existe en ghcr.io: las imágenes llevan -debian.
OSRM_IMAGE=${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.10.0-debian}
PBF_URL=https://download.geofabrik.de/south-america/argentina-latest.osm.pbf
PHOTON_JAR_URL=https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar
PHOTON_DB_URL=https://download1.graphhopper.com/public/south-america/argentina/photon-db-argentina-1.0-latest.tar.bz2
mkdir -p "$BASE/osrm" "$BASE/photon"
log() { echo "$(date -Is) $*"; }

# --- OSRM: preparar con recursos acotados (la Z440 también corre el chat) ---
log "OSRM: descargando mapa (solo si hay uno más nuevo)"
PBF="$BASE/osrm/argentina-latest.osm.pbf"
curl -fsSL --retry 3 -z "$PBF" -o "$PBF.tmp" "$PBF_URL" && [ -s "$PBF.tmp" ] && mv "$PBF.tmp" "$PBF" || rm -f "$PBF.tmp"
OSRM_RUN=(docker run --rm --cpus 6 --memory 24g -v "$BASE/osrm:/data" "$OSRM_IMAGE")
log "OSRM: extract"
"${OSRM_RUN[@]}" osrm-extract -p /opt/car.lua /data/argentina-latest.osm.pbf
log "OSRM: partition"
"${OSRM_RUN[@]}" osrm-partition /data/argentina-latest.osrm
log "OSRM: customize"
"${OSRM_RUN[@]}" osrm-customize /data/argentina-latest.osrm
log "OSRM: listo"

# --- Photon: índice ya construido para Argentina (formato 1.0) ---
log "Photon: descargando jar e índice"
curl -fL --retry 3 -o "$BASE/photon/photon.jar" "$PHOTON_JAR_URL"
rm -rf "$BASE/photon/photon_data.new" && mkdir -p "$BASE/photon/photon_data.new"
curl -fL --retry 3 "$PHOTON_DB_URL" | tar -xj -C "$BASE/photon/photon_data.new" --strip-components=1
rm -rf "$BASE/photon/photon_data" && mv "$BASE/photon/photon_data.new" "$BASE/photon/photon_data"
log "Photon: listo"
log "PREPARACIÓN COMPLETA"
