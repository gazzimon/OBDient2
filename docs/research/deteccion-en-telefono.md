# Detección en el teléfono para asistencia al conductor (E4)

Investigación del 2026-10-17. Criterio de filtro: **la app debe poder distribuirse**, así que el
código, los pesos y los datos de entrenamiento no pueden ser AGPL/GPL ni "solo uso académico". Las
licencias marcadas *a verificar* no se confirmaron leyendo el archivo LICENSE.

## Qué se puede detectar con una cámara de teléfono

| Función | Qué hace | Cómo | Encaje con OBDient2 |
|---|---|---|---|
| **Aviso de colisión frontal (FCW)** | Alerta si el vehículo de adelante se acerca demasiado rápido | Detector de objetos → distancia (borde inferior de la caja + plano de la calle) y **TTC** (cambio de escala de la caja entre imágenes) | Ya tenemos pose e intrínsecos calibrados por la AR: la distancia sale gratis |
| **Distancia de seguimiento** | Segundos hasta el vehículo de adelante; aviso si vas pegado | Distancia ÷ velocidad OBD | Velocidad OBD a 24 Hz |
| **Arranque del de adelante** | "El auto de adelante arrancó" en semáforos | Tracking de la caja + velocidad propia = 0 | Muy útil en ciudad, barato |
| **Peatón / ciclista / moto en trayectoria** | Alerta de usuarios vulnerables | Mismo detector + corredor de la ruta | El corredor ya existe (la cinta AR) |
| **Carril y zona transitable** | Aviso de salida de carril; **corregir la alineación lateral de la AR** | Segmentación ligera (TwinLiteNet, UFLD) | Sinergia directa: la cinta AR se puede ajustar al carril real |
| **Semáforos** | Estado rojo/verde | Clase "traffic light" del detector + color | Secundario |
| **Señales / límite de velocidad** | Exceso de velocidad | Detector + clasificador de señales | Los datasets públicos son europeos o académicos. **Alternativa sin visión**: `maxspeed` de OpenStreetMap a lo largo de la ruta |
| Monitoreo del conductor | Somnolencia | Cámara frontal | Fuera de alcance: la mayoría de los teléfonos no abre las dos cámaras a la vez |

## Proyectos de referencia

| Proyecto | Qué es | Licencia | Valor para nosotros |
|---|---|---|---|
| [Lyne-ADAS](https://github.com/Sherin-SEF-AI/Lyne-ADAS) | App Android (Kotlin, CameraX, LiteRT): FCW, headway, peatones, zona transitable, señales; niveles por gama de teléfono; tracker IoU; asistente de calibración | MIT | **La mejor referencia de arquitectura** y de cómo degradar en teléfonos baratos. Inmaduro (4 commits, 11 estrellas). **No copiar sus modelos**: usa YOLOv8n (AGPL) |
| [openpilot](https://github.com/commaai/openpilot) | El sistema abierto más maduro: carriles, auto de adelante y trayectoria desde una cámara | MIT (código) | Ideas y diseño. El modelo está atado al hardware y la cámara de comma; su entrenamiento es privado |
| [FlowPilot](https://github.com/flowdriveai/flowpilot) | Port de openpilot a Android vía chroot/proot | *a verificar* | Demuestra que es posible, pero es pesado y está casi sin mantenimiento |
| [open-adas](https://github.com/vietanhdev/open-adas) | FCW + LDW + señales en Jetson Nano | *a verificar* | Referencia de lógica de alertas; no es para teléfono |
| [Lane-Vision-AI](https://github.com/aaronmohan/Lane-Vision-AI) | Carriles con OpenCV clásico en Android | *a verificar* | Idea de respaldo sin modelo para teléfonos de gama baja |

## Modelos candidatos

### Detección de objetos

| Modelo | Licencia | Tamaño / COCO AP | Para el teléfono |
|---|---|---|---|
| **YOLOX-Nano** | Apache 2.0 | 0,9 M · 25,8 | Solo convoluciones: se convierte bien a TFLite INT8. **Candidato principal para empezar** |
| **EfficientDet-Lite0** | Apache 2.0 (Google, *a verificar*) | ~3 M · ~26 | Existe ya en TFLite INT8 oficial: cero conversión. Ideal para montar el circuito |
| **D-FINE-N** | Apache 2.0 (código y pesos COCO) | 4 M · 42,8 | Mucho más preciso, sin TFLite oficial: hay que convertir desde ONNX y los operadores de transformer son el riesgo. **Los pesos preentrenados en Objects365 pueden heredar los términos de ese dataset**: usar solo los de COCO |
| RT-DETRv2 | Apache 2.0 | más pesado | Fuera del presupuesto de un teléfono medio |
| ~~DEIMv2~~ | **Licencia propia; uso comercial requiere contactar a los autores** | — | Descartado |
| ~~YOLOv5/v8/v11 (Ultralytics)~~ | AGPL-3.0 | — | Descartado |

### Carriles y zona transitable

| Modelo | Licencia | Notas |
|---|---|---|
| **TwinLiteNet / TwinLiteNetPlus** | MIT (código) | 0,4 M parámetros: el más liviano. Zona transitable y líneas de carril. Lo usa Lyne-ADAS en TFLite |
| **UFLDv2** (Ultra-Fast-Lane-Detection) | MIT | Hay una versión **LiteRT ya convertida** en Hugging Face (`litert-community`), entrada 288×800 |
| YOLOPv2 | MIT | Detección + zona + carril en uno, pero 38,9 M parámetros: demasiado para el teléfono |

## Advertencia sobre los datos de entrenamiento

Que el código sea MIT o Apache no basta. **Los pesos heredan los términos del dataset** con que se
entrenaron:
- **BDD100K**: lo usan YOLOPv2 y TwinLiteNet.
- **CULane**: lo usa UFLD.
- **Mapillary Traffic Signs**: solo uso académico.
- **GTSRB/GTSDB**: licencia propia.

Todos deben revisarse antes de publicar. La salida limpia es **reentrenar con datos propios**: las
imágenes dudosas que guarde la app (E4), etiquetadas en la Z440 (E5). Es el ciclo que ya está en el
roadmap.

## Recomendación por fases

1. **F1 · Objetos** (YOLOX-Nano, o EfficientDet-Lite0 para arrancar): colisión frontal, distancia de
   seguimiento, arranque del de adelante y peatón en trayectoria. La distancia sale de nuestra
   calibración; el TTC, del cambio de escala, que funciona aun con la calibración imperfecta.
2. **F2 · Carril** (TwinLiteNet o UFLDv2): aviso de salida de carril y **corrección lateral de la
   cinta AR**.
3. **F3 · Límite de velocidad desde OpenStreetMap** (sin visión), comparado con la velocidad OBD. Las
   señales por visión quedan para cuando haya datos propios de Argentina.

Antes de F1: banco en el Xiaomi (ms por imagen con GPU, NNAPI y CPU) con el modelo elegido.
