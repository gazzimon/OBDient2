#!/usr/bin/env bash
# Copies the trip logs off the phone (development build, USB debugging on)
# into ./trips/. Uses run-as, so it only works on debuggable builds.
set -euo pipefail
PKG=com.obdient.obdient2
DEST="$(dirname "$0")/../trips"
mkdir -p "$DEST"
names=$(adb exec-out run-as "$PKG" ls files/trips 2>/dev/null | tr -d '\r' || true)
if [ -z "$names" ]; then
  echo "No hay viajes en el teléfono (o no está conectado: revisa 'adb devices')."
  exit 0
fi
for n in $names; do
  if [ -f "$DEST/$n" ] && [ "$(stat -c%s "$DEST/$n")" -gt 0 ]; then continue; fi
  adb exec-out run-as "$PKG" cat "files/trips/$n" > "$DEST/$n"
  echo "← $n ($(du -h "$DEST/$n" | cut -f1))"
done
