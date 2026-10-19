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
