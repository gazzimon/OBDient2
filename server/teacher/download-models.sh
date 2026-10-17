#!/usr/bin/env bash
# Descarga los modelos candidatos a maestro (docs/research/modelos-maestro-monocular.md)
# a ~/models en la Z440. Sin token: los tres son públicos.
#   systemd-run --user --unit=obdient-teacher-dl bash -c 'bash download-models.sh > download.log 2>&1'
set -uo pipefail
DEST=$HOME/models
declare -A REPOS=(
  [qwen-drive-1.0-4b]=Qwen/Qwen-Drive-1.0-4B
  [mimo-embodied-7b]=XiaomiMiMo/MiMo-Embodied-7B
  [alpamayo-1.5-10b]=nvidia/Alpamayo-1.5-10B
)
for name in qwen-drive-1.0-4b mimo-embodied-7b alpamayo-1.5-10b; do
  echo "$(date -Is) descargando ${REPOS[$name]} → $DEST/$name"
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e HF_HUB_ENABLE_HF_TRANSFER=1 \
    -v "$DEST:/models" python:3.12-slim bash -c "
      pip install -q --no-cache-dir --user 'huggingface_hub[hf_transfer]' &&
      python -c 'from huggingface_hub import snapshot_download as d; d(\"${REPOS[$name]}\", local_dir=\"/models/$name\")'" \
    && echo "$(date -Is) OK $name $(du -sh "$DEST/$name" | cut -f1)" \
    || echo "$(date -Is) FALLÓ $name"
done
echo "$(date -Is) DESCARGAS COMPLETAS"
