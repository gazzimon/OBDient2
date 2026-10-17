#!/usr/bin/env bash
# Exporta los detectores candidatos a TFLite INT8 para el teléfono (E4).
# Corre en la Z440 con la imagen oficial de Ultralytics (CPU basta para exportar).
#   systemd-run --user --unit=obdient-yolo-export --working-directory=$HOME/obdient-stack/ml \
#     bash -c 'bash export-detector.sh > export.log 2>&1'
set -uo pipefail
IMG=${IMG:-ultralytics/ultralytics:latest-cpu}
SIZE=${SIZE:-320}
OUT=$HOME/obdient-stack/ml
mkdir -p "$OUT"
docker pull -q "$IMG"
for M in yolo26n yolo11n; do
  echo "$(date -Is) exportando $M a TFLite INT8 ${SIZE}px"
  docker run --rm --cpus 6 -v "$OUT:/work" -w /work "$IMG" \
    yolo export model="$M.pt" format=tflite int8=True imgsz="$SIZE" \
    || echo "$(date -Is) FALLÓ $M"
done
# Resumen de entradas y salidas de cada .tflite generado.
docker run --rm -v "$OUT:/work" -w /work "$IMG" python - <<'PY'
import glob
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    import tensorflow as tf
    Interpreter = tf.lite.Interpreter
for f in sorted(glob.glob('/work/**/*.tflite', recursive=True)):
    it = Interpreter(model_path=f); it.allocate_tensors()
    ins = [(d['shape'].tolist(), d['dtype'].__name__, d['quantization']) for d in it.get_input_details()]
    outs = [(d['shape'].tolist(), d['dtype'].__name__, d['quantization']) for d in it.get_output_details()]
    print(f, 'IN', ins, 'OUT', outs)
PY
echo "$(date -Is) EXPORT COMPLETO"
