# ADR-0005 — Detección: maestro en la Z440, alumno en el teléfono, varias cámaras

**Estado:** aceptada · 2026-10-17

## Contexto

E4 agrega detección en el teléfono: colisión frontal, distancia de seguimiento, "arrancó el de
adelante", usuarios vulnerables en la trayectoria, carril y zona transitable, semáforos y límite de
velocidad (ver `docs/research/deteccion-en-telefono.md`). El negocio cobra por el **dispositivo** (el
adaptador OBD); la app acompaña sin costo.

## Decisión

### 1. Licencias: se priorizan las herramientas más robustas; la revisión se difiere

- Se usa el ecosistema más maduro aunque sea AGPL: **Ultralytics YOLO** para entrenar, exportar a
  TFLite INT8 y para segmentación.
- **Riesgo registrado:** la AGPL se activa al **distribuir**, no por cobrar. Entregar la app con el
  dispositivo es distribución, y obliga a ofrecer el código fuente de la app. Antes de un lanzamiento
  público se elige entre: publicar el código, comprar la licencia comercial de Ultralytics o cambiar a
  un alumno con licencia Apache (YOLOX, D-FINE).
- **Mitigación de diseño:** el runtime del teléfono carga un `.tflite` con un contrato de entrada y
  salida propio (cajas, clases, máscaras). Cambiar de familia de modelo no toca la app.
- Los términos de los datasets (BDD100K, CULane…) también quedan para esa revisión. La salida de
  fondo es la misma: datos propios.

### 2. Flujo maestro → alumno (destilación)

```
TELÉFONO (alumno)                          Z440 (maestro "Sr.")
 cámara(s) ─▶ YOLO pequeño INT8              GPU0: Qwen-Drive (contexto de escena, opcional)
   │          + tracking + distancia/TTC     GPU1: conjunto etiquetador
   │          + reglas de alerta                    · detector grande (YOLO-X / RT-DETR-X)
   │                                                · vocabulario abierto (Grounding DINO / OWLv2):
   ▼                                                  clases locales (colectivos, motos, perros…)
 captura selectiva ─── WiFi ───────────▶            · SAM 2: máscaras de carril y zona transitable
  · baja confianza / dudas                          · Depth Anything V2: distancia de referencia
  · eventos (frenada fuerte OBD/IMU,                · tracking temporal: consistencia entre imágenes
    volantazo, casi-colisión)                       │
  · muestreo aleatorio (diversidad)                 ▼
                                             consenso → etiquetas; desacuerdo → revisión humana
                                                    │
                                             entrenamiento del alumno con esas etiquetas
                                             + replay del dataset base (no olvidar)
                                                    │
                                             evaluación en set fijo propio (noche, lluvia…)
                                             + banco de latencia en teléfonos de referencia
                                                    │
 ◀────── OTA firmado, canario, rollback ──── export TFLite INT8 (calibrado con imágenes propias)
```

- **Destilación por pseudo-etiquetas** primero: es la más robusta y no exige acceso a las capas
  internas del maestro. La destilación por logits o características queda como mejora posterior.
- El maestro corre **sin restricción de tiempo real**, así que puede ser tan grande como entre en
  24 GB; el alumno hereda su criterio para las condiciones locales.
- Lecciones del paper de Qwen-Drive que aplican: mezclar datos base (no olvidar), filtrar por
  consistencia (descartar mucho), set de validación fijo e intocable, métricas propias sobre viajes
  reales.

### 3. Varias cámaras

- **Objetivo:** gran angular para lo cercano y lateral (peatón que cruza, auto en el carril de al
  lado), principal para el frente, teleobjetivo para lo lejano (auto de adelante a distancia,
  semáforos, señales) y, si el teléfono lo permite, la frontal para la atención del conductor.
- **Realidad de Android:** el acceso simultáneo depende del fabricante. Las cámaras físicas se
  exponen como *logical multi-camera* (API 28+), y el streaming concurrente solo funciona en las
  combinaciones que el fabricante habilita. Muchos Xiaomi no exponen las cámaras auxiliares a apps de
  terceros. La frontal y la trasera a la vez requieren *concurrent camera* (Android 11+, soporte
  parcial).
- **Por eso:** la app **sondea en el arranque** qué cámaras y combinaciones hay (pantalla de
  diagnóstico, como el banco del adaptador). El pipeline acepta N flujos y **degrada a una sola
  cámara** sin cambiar la lógica. Si el sondeo muestra que `vision-camera` no alcanza para el acceso
  multicámara, ese tramo se hace como módulo nativo Kotlin sobre Camera2.
- La distancia con varias cámaras **no** se calcula por estéreo: la separación entre lentes (~1 cm)
  no sirve a distancias de calle. Cada cámara aporta cobertura y resolución, y la distancia sigue
  saliendo de la geometría calibrada y del TTC.

### 4. Bibliotecas

| Lado | Elección |
|---|---|
| Teléfono | `react-native-vision-camera` 5 (frame processors) + `react-native-fast-tflite` 3 (LiteRT, delegado GPU/NNAPI); módulo Kotlin sobre Camera2 solo si hace falta para multicámara |
| Alumno | Ultralytics YOLO nano (detección + segmentación), export TFLite INT8 |
| Maestro | Ultralytics (modelos grandes), Grounding DINO / OWLv2, SAM 2, Depth Anything V2, ByteTrack; en contenedores en la Z440 |
| Datos | FiftyOne (curación y visualización), Label Studio o CVAT (revisión humana) |

## Consecuencias

- La captura de imágenes se suma al registro de viaje. El almacenamiento y la subida van por WiFi y
  con cuota, y las imágenes se tratan como datos personales (caras, matrículas): se difuminan en el
  servidor antes de guardarlas.
- La Z440 pasa a ser necesaria para cerrar el ciclo (E5): hace falta acceso y un endpoint de subida.
- Queda pendiente, antes de publicar: la revisión de licencias (punto 1).
