# vLLM (con y sin MTP) frente a ninfer-3090 en la Z440 — 2026-10-26

Chat: Qwen3.8-27B INT4 en la GPU0 (RTX 3090, **290 W**), 32k de contexto. Rama `bench/mtp-vs-ninfer`, compose de prueba `server/docker-compose.bench.yml` (producción no se tocó; solo estuvo parada durante las ventanas de medición, 22:38–22:45 y 23:24–23:46, y se restauró y verificó cada vez con 16 casos de herramientas idénticos a la referencia).

## Qué mide y qué no

- **Base:** vLLM 0.31.0, W4A8 (`VLLM_MARLIN_INPUT_DTYPE=int8`), KV fp8, `max-num-seqs=4`, parser `qwen3_coder`. Mismos scripts que el ADR-0006 (prompts de ~1,2k / 9k / 23k / 30k tokens, semillas distintas para no acertar el cache). Los números de base a 290 W vienen de la sesión del A/B de potencia (brazos 2 y 4) y de `conc.py` corrido antes de parar el chat.
- **Brazo A (vLLM + MTP):** `--speculative-config {"method":"mtp","num_speculative_tokens":3}`, el valor de la ficha del checkpoint. **No arranca** (ver abajo), así que no hay números de decode ni de aceptación.
- **Brazo B (ninfer):** rama `integration/ashalliants-adoption-20261016` (`d8c2925`), imagen local `ninfer-3090:sm86` (5,78 GB, CUDA 13.1.2), modelo `qwen3_8_27b.ninfer` de WarlaxZ (17,67 GiB; incluye visión, MTP y DFlash2). Flags: `--max-context 32768 --kv-capacity 32768 --kv-dtype int8 --spec mtp --draft-tokens 3 --lm-head-draft --vision --prefill-chunk 1024 --max-pending-requests 16`, con `--max-concurrency` 1 y 2. Por la ruta HTTP `/v1`, no `ninfer_bench`.
- El `assistant:eval` son reglas, sin modelo juez, con herramientas simuladas, **2 corridas × 29 casos**: una diferencia de 2–4 casos es una señal, no una prueba.
- **No probado:** imágenes por `/v1` en ninfer (se cargó con `--vision`, no se envió ninguna), el equivalente al sleep mode (`/v1/models/{id}/suspend`), `--draft-tokens` 2 y 4, DFlash2, y carga sostenida de horas.

## Fase 0 — qué soporta cada uno

| Capacidad | vLLM 0.31.0 (hoy) | ninfer-3090 |
|---|---|---|
| Formato del modelo | safetensors compressed-tensors (nuestro checkpoint) | `.ninfer` propio. Se **descarga ya hecho** (17,67 GiB de Hugging Face); no hay conversor documentado desde nuestro checkpoint |
| Tool calling | `qwen3_coder` (XML `<function=…>`) | Soportado: acepta las formas XML de Qwen, `strict`, `tool_choice`, `parallel_tool_calls`; `--tolerant-tool-calls` opcional |
| Reasoning | `--reasoning-parser qwen3` | Soportado: `reasoning_content` separado, `enable_thinking`, `--no-thinking`, presupuesto de thinking |
| Imágenes | `--limit-mm-per-prompt image=2` | Soportado con `--vision` (cargó; **no probado**) |
| Sleep mode | `--enable-sleep-mode` | Equivalente distinto: `--model-suspend`, `POST /v1/models/{id}/suspend` y `/resume`, `--sleep-idle-seconds` (**no probado**) |
| Concurrencia | `--max-num-seqs=4` (lotes continuos) | `--max-concurrency` 1 o 2 (más es rechazado); el resto espera en cola |
| MTP para este checkpoint | Soportado en el código (`qwen3_5_mtp`); la ficha del checkpoint lo documenta | Soportado (`--spec mtp`) |
| Error de contexto | 400 con "maximum context length" | 400 `context_length_exceeded` ("prepared prompt exceeds Engine max_context 32768"); **nuestro cliente lo reconoce sin cambios** (verificado contra `OVERFLOW_WORDS`) |

## Brazo A — vLLM + MTP: no entra en una 3090 de 24 GB

El arranque falla al cargar la cabeza MTP. Salida tal cual (`llm-chat-bench`, `qwen3_5_mtp.py:246`, `self.lm_head = ParallelLMHead(`):

```
torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.37 GiB. GPU 0 has a total capacity of 23.56 GiB of which 1.22 GiB is free. Including non-PyTorch memory, this process has 22.34 GiB memory in use. Of the allocated memory 20.96 GiB is allocated by PyTorch
```

La cabeza crea su propio `lm_head` sin cuantizar (248.320 × 5.120 en bf16 = 2,37 GiB) y no hay flag para compartir el del modelo. Variantes probadas:

| Variante | Libre al cargar la cabeza | Resultado |
|---|---|---|
| Configuración de producción + MTP n=3 | 1,22 GiB | OOM |
| + `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` | 1,22 GiB | OOM idéntico |
| + sin visión (`image:0`) | 2,03 GiB | OOM, faltan 0,34 GiB |

Resolverlo exigiría tocar vLLM (compartir el `lm_head`) o quitar la visión **y** recortar otros 0,34 GiB: fuera de esta tanda. Con la cuantización W4A8 o sin ella el resultado es el mismo (los pesos no cambian).

## Tabla base frente a A y B

| | Base (vLLM, 290 W) | A (vLLM + MTP) | B (ninfer, C=1) | B (ninfer, C=2) |
|---|---|---|---|---|
| Arranque en frío | ~4–5 min | OOM | **34 s** | 34 s |
| VRAM usada (GPU0) | 21,6 GB | — | **18,5 GB** (fija en el soak) | — |
| Prefill en frío ~9k tokens (TTFT) | **2.233 tok/s (4,1 s)** | — | 1.550 tok/s (6,0 s) | — |
| Prefill en frío ~23k (TTFT) | no medido a 290 W (a 250 W: 1.575 tok/s, 14,7 s) | — | 1.480 (15,7 s) | — |
| Prefill en frío ~30k (TTFT) | **1.868 tok/s (16,1 s)** | — | 1.460 tok/s (20,6 s) | — |
| Decode, 1 pedido (ensayo de 300 tok) | 44–45 tok/s | — | **76–77 tok/s** | 77–80 |
| Decode en llamadas a herramientas (log del servidor) | no medido en el log | — | **114–146 tok/s** (aceptación MTP 75–100 %) | — |
| Decode en prosa larga (log) | 44–45 (ensayo de 300 tok) | — | 72,6 tok/s (aceptación 36,8 %) | — |
| 4 pedidos cortos a la vez, tiempo total | **8,7 s** | — | 19,2 s | 12,4 s |
| 4 pedidos de ~12k a la vez, tiempo total | **18,3 s** | — | 33,0 s | 27,0 s |
| TTFT máx. con 4 pedidos de ~12k | **10,5 s** | — | 28,8 s | 22,4 s |
| Pregunta corta detrás de un prefill de 12k | **2,1 s** | — | 16,3 s | 16,0 s |
| Prefix cache con prefijo de ~5k (5 colas) | 2,8 s → 0,28 s desde la 2.ª; 73 % de aciertos | — | 3,6 s los 3 primeros → 0,08 s desde la 4.ª; 98–99 % de reutilización en el eval | — |
| `assistant:eval --runs 2` | 52/58 | — | **56/58** | — |
| Fallos del eval | casos 10, 24 y límite de palabras en movimiento (más variación entre corridas) | — | caso 10 (el modelo no usa herramientas, igual que en la base) y caso 20 (tuteo) | — |
| Soak 25 turnos × 2 (vacías / degeneradas / ΔVRAM) | 0 / 0 / +748 MiB la 1.ª pasada, 0 la 2.ª | — | 0 / 0 / 0 | — |
| Herramientas: JSON bien formado | 12/12 | — | 12/12 | — |
| Herramientas: determinismo con temperatura 0 | 16/16 idénticos entre corridas | — | no aplica (otro cuantizado) | — |
| Herramientas: mismos argumentos que vLLM | — | — | 10/12 equivalentes como JSON; 2 distintos en el texto de la consulta o el nombre del PID (`INTAKE_TEMP` frente a `INTAKE_AIR_TEMP`) | — |
| `reasoning_content` separado | 8/8 | — | 8/8 | — |

Los "tok/s" de la fila de 4 pedidos de ninfer con C=1 no son sumables: los pedidos se atienden en fila, por eso se compara el **tiempo total** y no la suma de velocidades por pedido.

## Diferencias de comportamiento

- **Llamadas a herramientas y razonamiento:** equivalentes de cara a nuestro cliente. `agent-loop.ts` y `openai-chat-client.ts` funcionaron sin cambios en 29 casos × 2 corridas, incluido el manejo del error de contexto.
- **Calidad de salida:** el cuantizado de ninfer es distinto (pesos de 15,6 GiB frente a ~18 GiB) y el modelo no dice exactamente lo mismo; en el eval no fue peor (56/58 frente a 52/58), pero las dos corridas no alcanzan para afirmar que sea mejor.
- **Dónde gana:** decode (1,7× en pedidos sueltos, hasta 3× en llamadas a herramientas, donde la especulación acierta casi siempre), arranque, memoria (~3 GB menos de VRAM usada) y reutilización de prefijo cuando ya está en cache.
- **Dónde pierde:** prefill en frío (−30 % a 9k, −22 % a 30k), concurrencia y, sobre todo, **la espera de una pregunta corta detrás de un prefill largo (16 s frente a 2 s)**. Es el patrón de nuestro asistente: el juez de `research`, las preguntas sugeridas y el resumen en segundo plano son llamadas cortas al mismo modelo, que con ninfer esperarían a que termine cualquier prefill largo en curso.

## Qué habría que cambiar para adoptar B

- **Dos motores:** `stt` y `embed` siguen en vLLM (imagen de 32,3 GB cada una); ninfer añade una imagen de 5,78 GB, un modelo de 17,67 GiB que se descarga ya hecho de un tercero (sin conversor desde nuestro checkpoint) y un fork de comunidad con releases propias que habría que fijar por commit.
- **Stack:** `docker-compose.yml` (servicio, flags con `--flag valor` separado, `--api-key`), la guardia térmica (`guard.sh` mira el nombre del contenedor), la gestión de GPU entre turnos de lote (sleep mode de vLLM frente a `/suspend` de ninfer, ADR-0006), `/metrics` con otros nombres, y probar visión y `suspend` antes de depender de ellos.
- **Repo:** el cliente no necesita cambios; el ADR-0006, `server/docker-compose.yml` y los scripts de medición sí.
- **Mantenimiento:** dos pilas de CUDA/drivers (CUDA 13.1 frente a la de vLLM), dos formas de diagnosticar fallos.

## Recomendación

**Quedarse en vLLM sin MTP (que no entra en 24 GB):** ninfer decodifica casi el doble, pero pierde en prefill, concurrencia y en la espera de pedidos cortos detrás de uno largo, exigiría dos motores y no probé imágenes ni suspend; no gana claramente en lo que importa a la casa. Si más adelante el decode pasa a ser el cuello, vale repetir con `--max-concurrency 2`, imágenes y `suspend` ya probados, y mirar si ninfer arregla la espera de pedidos cortos.

## Archivos y reproducción

- Compose: `server/docker-compose.bench.yml` (`--profile bench` para vLLM+MTP, `--profile ninfer` para ninfer; `SPEC_N`, `NINFER_N`, `NINFER_C`, `IMG`, `ALLOC` como variables).
- Scripts de medición (no versionados): `bench-llm.py`, `conc.py`, `hol.py`, `prefix.py`, `soak.py`, `tools.py` en el scratchpad de la sesión; el eval es `npm run assistant:eval -- --runs 2`.
- En la Z440 quedan, sin usar: `~/ninfer-bench/` (código, 17,7 GiB de modelo) y la imagen `ninfer-3090:sm86` (5,78 GB).
