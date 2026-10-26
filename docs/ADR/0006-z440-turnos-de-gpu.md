# ADR-0006 — Z440: una GPU en línea, una GPU para lotes

**Estado:** aceptada · 2026-10-17

## Contexto

La Z440 (2× RTX 3090 de 24 GB, Xeon E5-1620 v4 de 8 hilos, 60 GB de RAM) va a servir cargas muy
distintas:
- **En línea, latencia baja:** el chat de la app (de OBDient, se integrará más adelante).
- **Por lotes:** el maestro etiquetador de E4/E5, Qwen-Drive en modo diferido, el entrenamiento del
  alumno y el difuminado de caras y patentes.

Hasta hoy corría `vllm-prod` (R1-Distill-Qwen-32B AWQ) repartido en las dos GPUs con TP=2 y al 95 %
de memoria.

Restricciones medidas:
- Las 3090 se comunican por **PCIe a través del procesador, sin NVLink** (`nvidia-smi topo`: PHB).
  Repartir un modelo entre ambas penaliza la latencia.
- La CPU de 8 hilos limita el preprocesamiento de imágenes y video.

## Decisión

1. **GPU0 = en línea; GPU1 = lotes.** El chat nunca compite con un entrenamiento, y nada depende del
   enlace PCIe.
2. **Chat: Qwen3.8-27B INT4 en una sola GPU** (contenedor `llm-chat`, `~/obdient-stack`):
   - Puerto 8000 y misma clave que `vllm-prod`, así que los clientes existentes siguen funcionando.
   - Contexto de 16k y caché KV en FP8.
   - Parser de herramientas **`qwen3_coder`**: el modelo emite `<function=…><parameter=…>`, y
     `hermes` no lo reconoce.
   - Medido el 2026-10-17: **~40 tokens/s** por solicitud y llamada a herramienta correcta en 0,9 s.
3. **`--enable-sleep-mode`:** los pesos pueden bajar a la RAM y volver en segundos, para prestar la
   GPU0 a un lote nocturno sin reiniciar. Los endpoints `/sleep` y `/wake_up` de vLLM requieren
   `VLLM_SERVER_DEV_MODE=1`, que también expone endpoints de depuración. Se activará cuando exista el
   worker de lotes y quede detrás del gateway, no expuesto en la LAN.
4. **Lotes "por modelo":** el worker agrupa las tareas y carga cada modelo una vez por lote (todas las
   fotos por el detector, luego todas por SAM 2…), no una vez por foto.
5. **Modo exclusivo** para probar LLMs grandes con TP=2: se paran los servicios de `obdient` y se
   arranca el de prueba. `vllm-prod` quedó parado con `restart=no` y se recupera desde
   `~/serve/docker-compose.yml`.
6. **Guardia térmica por contenedor:** `~/serve/guard.sh <nombre>` como servicio de usuario de
   systemd (`llm-chat-guard.service`, versionado en `server/`). Cada servicio nuevo con GPU lleva el
   suyo.
7. **Un solo punto de entrada** (gateway) cuando haya más de un servicio: la app habla con una
   dirección y no sabe qué contenedor responde.

8. **Actualización 2026-10-19: la voz vive en la GPU1.** `stt` (Voxtral Mini 4B Realtime, vLLM
   0.31.0, la misma imagen que `llm-chat`, perfil `stt`, puerto 8002, guardia `stt-guard`) ocupa ~16 GB
   (70 %) de la GPU1 en forma permanente; los lotes usan lo que queda o paran `stt` mientras corren.
   La GPU0 está llena con el chat. La app nunca le habla directo: pasa por `obdient-tools` en la K16.
   Incidente del mismo día: la GPU0 se cayó del bus (`NV_ERR_GPU_IS_LOST`) al desconectar la red por
   obras; volvió con un apagado completo. Si se repite: conectores PCIe, fuente, UPS.

## Consecuencias

- `server/docker-compose.yml` es la fuente de verdad del stack, con perfiles: `online` hoy, `batch`
  cuando llegue el maestro.
- Lo próximo en la Z440: OSRM + Photon (solo CPU) y el worker de lotes en la GPU1.
- Si el chat necesita más contexto o más concurrencia que lo que deja la GPU0, la opción es un
  modelo más chico, no volver a TP=2.

**Actualización 2026-10-26: el contexto del chat pasa de 16k a 32k.** El límite no era del hardware sino de
la configuración: Qwen3.8-27B es un modelo híbrido (3 de cada 4 capas son de atención lineal, con un estado por
secuencia) y con `--max-num-seqs=8` y 0,92 de memoria el log de arranque daba solo 34.695 tokens de KV. Con
`--max-num-seqs=4` y 0,95 da **61.895 tokens** (concurrencia 1,89x para 32k; entraría hasta ~49k, no 65k).
`--max-model-len=32768`. Medido antes y después con los mismos prompts: el prefill (~1.100 tok/s en frío) y la
generación (~41 tok/s) no cambian, y entra un prompt de 27.727 tokens (27 s en frío). El prefix cache ya
funcionaba (65 a 76 % de aciertos en el uso real). Queda la GPU0 en 22 de 24 GB. Pendiente: la cabeza MTP del
checkpoint (0,85 GB) para decodificación especulativa.

**Actualización 2026-10-26 (2): W4A8.** `VLLM_MARLIN_INPUT_DTYPE=int8` (activaciones int8 en el kernel Marlin;
el checkpoint es compressed-tensors simétrico, no hace falta ningún parche; idea tomada de club-3090). Medido
en la Z440 contra la configuración anterior, mismos prompts, arranque limpio de cada brazo:

| Prompt | Prefill en frío antes → ahora | TTFT antes → ahora |
|---|---|---|
| ~1,2k tokens | ~1.050 → ~1.870 tok/s | 1,1 → 0,6 s |
| ~9,3k | ~1.115 → ~1.775 | 8,4 → 5,2 s |
| ~23k | ~1.045 → ~1.575 | 22,2 → 14,7 s |
| ~30k | ~1.010 → ~1.485 | 29,8 → 20,4 s |

La generación baja de ~42 a ~41 tok/s (−3 %). El pool KV no cambia (61.895 tokens). Evaluación del asistente
(`assistant:eval --runs 2`): 52/58 con W4A8 y 50/58 sin él; los fallos son los mismos casos en ambos (10, 24 y el
límite de palabras en movimiento), o sea que no hay pérdida de calidad medible. Soak de 25 turnos con contextos
crecientes, dos veces: 0 respuestas vacías, 0 degeneradas, la VRAM crece 748 MiB en la primera pasada
(calentamiento) y 0 en la segunda. La petición corta detrás de un prefill de 12k tarda 3,5 s antes y 2,1 s ahora:
el bloqueo de 28 s que vimos antes no se reproduce, así que `--long-prefill-token-threshold` no se tocó.
No probado: `--mamba-block-size` (podría romper el prefix cache del prefijo de ~5,7k tokens) ni MTP.

**Actualización 2026-10-26 (3): `--mamba-block-size` y potencia.**
- `--mamba-block-size=8192` (de club-3090, donde recupera ~20 % del pool): **sin efecto aquí**. El pool sigue en
  61.895 tokens, el bloque de atención sigue en 1568 y el prefix cache da lo mismo con un prefijo de ~5,1k tokens
  (73 % de aciertos, 2,8 s en frío → 0,28 s con cache) y de ~10k (74 %). Se revirtió; no se usa.
- **Potencia de la GPU0, 250 W contra 290 W**, cuatro brazos alternados (A,B,A,B) con la misma carga y
  muestreo de temperatura cada 2 s. Cada brazo repitió dentro de ~1 %:

| | 250 W | 290 W | Cambio |
|---|---|---|---|
| Prefill en frío, 9k tokens | ~1.765 tok/s | ~2.220 | +26 % |
| Prefill en frío, 30k tokens | ~1.500 | ~1.867 | +24 % |
| Decode, un pedido | ~41,6 tok/s | ~45,5 | +9 % |
| 4 pedidos de ~1,2k: total | ~148 tok/s | ~156 | +5 % |
| 4 pedidos de ~12k: total | ~101 | ~112 | +11 % |
| Pico de temperatura (núcleo / VRAM) | 57 / 82 °C | 57 / 84 °C | +2 °C en VRAM |

La guardia avisa a 100 °C de VRAM y 85 °C de núcleo (corta a 107 y 90), así que hay ~16 °C de margen con la
carga de la prueba (un minuto y medio). El límite se cambia en caliente con `sudo nvidia-smi -i 0 -pl N`.
