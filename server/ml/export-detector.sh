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
# Imagen propia (Dockerfile.export): versiones fijadas, sin auto-instalación.
IMG=${IMG:-obdient/yolo-export:8.4.82}
SIZE=${SIZE:-320}
# INT8 calibra con imágenes reales; coco8 (4 imágenes, el valor por defecto)
# degrada el modelo. coco128 por ahora; luego, cuadros propios de los viajes.
CALIB=${CALIB:-coco128.yaml}
# YOLO26n queda fuera: su cabeza end-to-end no convierte con onnx2tf
# ("Output tensors of a Functional model must be the output of a Layer").
MODELS=${MODELS:-yolo11n}
OUT=$HOME/obdient-stack/ml
mkdir -p "$OUT"
docker image inspect "$IMG" >/dev/null 2>&1 || docker build -t "$IMG" -f "$OUT/Dockerfile.export" "$OUT"

# Un solo contenedor: las dependencias de exportación se instalan una vez.
docker run --rm --cpus 6 -v "$OUT:/work" -w /work "$IMG" bash -c "
  set -u
  mkdir -p /work/models
  # Cada export reescribe <modelo>_saved_model/: copiar el resultado enseguida.
  for M in ${MODELS}; do
    echo \"\$(date -Is) \$M INT8 ${SIZE}px (calibración ${CALIB})\"
    yolo export model=\$M.pt format=tflite int8=True data=${CALIB} imgsz=${SIZE} \\
      && cp \$M\_saved_model/\$M\_int8.tflite /work/models/\$M-int8-${SIZE}.tflite \\
      || echo \"\$(date -Is) FALLÓ \$M int8\"
    echo \"\$(date -Is) \$M FP16 ${SIZE}px\"
    yolo export model=\$M.pt format=tflite half=True imgsz=${SIZE} \\
      && cp \$M\_saved_model/\$M\_float16.tflite /work/models/\$M-fp16-${SIZE}.tflite \\
      || echo \"\$(date -Is) FALLÓ \$M fp16\"
  done
  echo '== entradas y salidas =='
  python - <<'PY'
import glob
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    import tensorflow as tf
    Interpreter = tf.lite.Interpreter
import numpy as np
from PIL import Image
img = Image.open('/usr/src/ultralytics/ultralytics/assets/bus.jpg').convert('RGB')
for f in sorted(glob.glob('/work/models/*.tflite')):
    it = Interpreter(model_path=f); it.allocate_tensors()
    fmt = lambda ds: [(d['shape'].tolist(), d['dtype'].__name__, tuple(float(x) for x in d['quantization'])) for d in ds]
    print(f, 'IN', fmt(it.get_input_details()), 'OUT', fmt(it.get_output_details()))
    # Prueba real (bus.jpg): ¿coordenadas normalizadas o en píxeles?
    i = it.get_input_details()[0]; o = it.get_output_details()[0]
    size = i['shape'][1]
    x = np.asarray(img.resize((size, size)), dtype=np.float32)[None] / 255.0
    if i['dtype'] != np.float32:
        s, z = i['quantization']; x = np.clip(np.round(x / s + z), -128, 127).astype(i['dtype'])
    it.set_tensor(i['index'], x); it.invoke()
    y = it.get_tensor(o['index']).astype(np.float32)
    if o['dtype'] != np.float32:
        s, z = o['quantization']; y = (y - z) * s
    best = y[0, 4:].max(axis=0); k = int(best.argmax())
    print('   max coord', float(y[0, :4].max()), '| mejor score', float(best.max()), 'clase', int(y[0, 4:, k].argmax()), 'caja', y[0, :4, k].round(3).tolist())
PY
"
echo "$(date -Is) EXPORT COMPLETO"
