# Modelos grandes de conducción para el maestro (Z440), con una sola cámara

Investigación del 2026-10-17, a partir de los modelos que compara el paper de Qwen-Drive-1.0. Las
licencias y las configuraciones de cámaras marcadas *a verificar* salen de resúmenes o de terceros, no
del model card oficial.

**Criterio:** OBDient2 tiene **una sola cámara frontal** (la del teléfono), y la Z440 tiene **24 GB
por GPU** (la GPU1 es la de lotes). Ninguno de estos modelos corre en el teléfono: son candidatos a
**maestro**, para revisar viajes, etiquetar y explicar escenas.

## Descartados para nuestro caso

| Modelo | Por qué |
|---|---|
| BEVFormerV2, PETR, PETRv2 | Percepción 3D **multivista**: 6–8 cámaras calibradas alrededor del auto. Sin sentido con una cámara |
| SimWAM, DriveWAM, ExploreVLA, MindVLA-U1, DriveWLA | Investigación muy reciente (2026), modelos de mundo con expertos de video pesados; pesos y licencias poco claros. Seguirlos, no adoptarlos aún |
| Cosmos-Reason2-32B | 32B no entra en 24 GB en BF16 |

## Candidatos

| Modelo | Qué hace | ¿Monocular? | Tamaño / GPU | Licencia |
|---|---|---|---|---|
| **Alpamayo 1.5 (10B, NVIDIA)** | Razonamiento causal + **trayectoria** de 6,4 s (64 puntos a 10 Hz) con historia de movimiento | **"Cantidad de cámaras flexible"** en la 1.5: es el mejor candidato para trayectoria con una cámara | 8,2B + 2,3B; NVIDIA pide ≥24 GB → justo en la GPU1 | Pesos OpenMDW-1.1 (uso comercial según NVIDIA), código Apache-2.0 *a verificar en el model card* |
| **MiMo-Embodied-7B (Xiaomi)** | VLM de conducción + robótica: percepción, predicción de estado y planificación **en texto** | Sí: imagen + texto, una imagen alcanza | ~16 GB en BF16 | MIT *a verificar* (visto en un espejo) |
| **Qwen-Drive-1.0** | El más fuerte en QA de conducción de los gráficos; planificación con 3 cámaras frontales | El QA funciona con una vista; **la planificación espera 3** | ~12 GB en BF16 | Apache-2.0 |
| AutoVLA (UCLA, NeurIPS 2025) | VLA con acciones tokenizadas, SFT + GRPO | No confirmado | No confirmado | Sin licencia clara en el repo *a verificar* |
| ReCogDrive (Xiaomi Research, ICLR 2026) | InternVL3-8B + planificador por difusión; NAVSIM 89,6 solo con cámaras | Vistas no confirmadas | ~8B | Pesos anunciados, sin confirmar |

## Cómo encajan en OBDient2

- **Etiquetador/verificador:** MiMo-Embodied-7B o Qwen-Drive en modo QA. Preguntas sobre una imagen
  ("¿hay un peatón cruzando?", "¿de qué color está el semáforo?") para confirmar o corregir lo que
  detectó el alumno.
- **Revisión de viajes y trayectoria:** Alpamayo 1.5 con la cámara del teléfono más la historia de
  movimiento que ya graba el registro de viaje (ego en marco local), para comparar la trayectoria del
  modelo con la conducida.
- **Uno por vez en la GPU1** (ADR-0006): ningún par entra junto en 24 GB.

## Experimento propuesto (antes de adoptar cualquiera)

Un mismo conjunto de 20–50 cuadros de viajes propios (registro de viaje + capturas), pasado por
Alpamayo 1.5, MiMo-Embodied-7B y Qwen-Drive. Se mide:
- VRAM y segundos por cuadro;
- en QA, acierto sobre preguntas con respuesta conocida;
- en trayectoria, distancia a la trayectoria realmente conducida.

## Fuentes

- AutoVLA: [repo](https://github.com/ucla-mobility/AutoVLA), [paper](https://arxiv.org/abs/2506.13757v3)
- Alpamayo: [R1-10B en Hugging Face](https://huggingface.co/nvidia/Alpamayo-R1-10B),
  [1.5-10B en NGC](https://catalog.ngc.nvidia.com/orgs/nim/nvidia/models/alpamayo-1-5-10b/),
  [información de NVIDIA](https://www.nvidia.com/en-us/solutions/autonomous-vehicles/alpamayo/llm-info/)
- ReCogDrive: [paper](https://arxiv.org/abs/2506.08052v1), [ICLR 2026](https://iclr.cc/virtual/2026/poster/10010169)
- MiMo-Embodied: [model card](https://huggingface.co/XiaomiMiMo/MiMo-Embodied-7B)
- SimWAM: [repo](https://github.com/H-EmbodVis/SimWAM), [paper](https://arxiv.org/html/2608.07468);
  MindVLA-U1: [alphaxiv](https://www.alphaxiv.org/abs/2605.12624); DriveWLA: [paper](https://arxiv.org/html/2610.17903)
