#!/usr/bin/env bash
# Exporta los detectores candidatos a TFLite para el teléfono (E4).
# Corre en la Z440 con la imagen oficial de Ultralytics (CPU basta para exportar).
#   systemd-run --user --unit=obdient-yolo-export --working-directory=$HOME/obdient-stack/ml \
#     bash -c 'bash export-detector.sh > export.log 2>&1'
#
# Versión FIJADA en 8.4.82: desde 8.4.83 Ultralytics exporta por LiteRT
# (litert-torch), que con PyTorch 2.14 falla ('aten' has no attribute
# 'cholesky') y ya no admite FP16. 8.4.82 usa el camino ONNX → TFLite, con
# INT8 y FP16, y ya trae YOLO26.
set -uo pipefail
IMG=${IMG:-ultralytics/ultralytics:8.4.82-cpu}
SIZE=${SIZE:-320}
# INT8 calibra con imágenes reales; coco8 (4 imágenes, el valor por defecto)
# degrada el modelo. coco128 por ahora; luego, cuadros propios de los viajes.
CALIB=${CALIB:-coco128.yaml}
OUT=$HOME/obdient-stack/ml
mkdir -p "$OUT"
docker pull -q "$IMG"

# Un solo contenedor: las dependencias de exportación se instalan una vez.
docker run --rm --cpus 6 -v "$OUT:/work" -w /work "$IMG" bash -c "
  set -u
  for M in yolo26n yolo11n; do
    echo \"\$(date -Is) \$M INT8 ${SIZE}px (calibración ${CALIB})\"
    yolo export model=\$M.pt format=tflite int8=True data=${CALIB} imgsz=${SIZE} || echo \"\$(date -Is) FALLÓ \$M int8\"
    echo \"\$(date -Is) \$M FP16 ${SIZE}px\"
    yolo export model=\$M.pt format=tflite half=True imgsz=${SIZE} || echo \"\$(date -Is) FALLÓ \$M fp16\"
  done
  echo '== entradas y salidas =='
  python - <<'PY'
import glob
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    import tensorflow as tf
    Interpreter = tf.lite.Interpreter
for f in sorted(glob.glob('/work/**/*.tflite', recursive=True)):
    it = Interpreter(model_path=f); it.allocate_tensors()
    fmt = lambda ds: [(d['shape'].tolist(), d['dtype'].__name__, tuple(float(x) for x in d['quantization'])) for d in ds]
    print(f, 'IN', fmt(it.get_input_details()), 'OUT', fmt(it.get_output_details()))
PY
"
echo "$(date -Is) EXPORT COMPLETO"
