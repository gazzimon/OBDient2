# Verificación de respuestas del modelo: lo medido en la Z440 (2026-10-13)

Recuperado el 2026-10-18 de `~/z440-eval` en la Z440, que no está versionado: scripts, conjuntos de
datos y resultados quedan allá. Generador y juez de entonces: **R1-Distill-Qwen-32B AWQ** (`r1-32b`),
hoy dado de baja; el chat actual es Qwen3.8-27B. Los números valen como orientación, no se repitieron
con Qwen3.8.

## Qué se probó

**Jueces de afirmaciones**: dada una afirmación y una fuente, ¿la fuente la sostiene?

| Juez | Tamaño | Conjunto real (31 pares) | Adversarial (39) | Tiempo |
|---|---|---|---|---|
| HHEM (Vectara) | chico, CPU/GPU | acierto 0,74 · atrapa 8/9 alucinaciones · **falsa alarma 32 %** | — | 19 s los 31 |
| MiniCheck Flan-T5-Large | 0,8 B | acierto 0,61 · atrapa 9/9 · **falsa alarma 55 %** · cálculos derivados 0/5 | — | 34 s |
| LLM con cita literal (`judge_llm.py`) | 32 B | **acierto 1,00**, 0 falsas alarmas, cálculos 5/5 | **1,00** (números cercanos, unidades, polaridad, cuantificadores, causalidad invertida…) | ~7 s por afirmación |

Los jueces chicos sirven como filtro barato pero marcan como falsas demasiadas afirmaciones correctas;
no razonan cuentas ("el viaje dura 205 minutos" a partir de horarios).

**Pipeline completo** (`demo_compare.py`, 12 preguntas, 9 del auto y 3 generales):

| Nivel | Qué hace | Aciertos | Tiempo típico |
|---|---|---|---|
| L0 plano | el modelo responde solo | 6/12 | 5–11 s |
| L1 auditor | L0 + cada afirmación verificada; anota, no cambia | 6/12 | 35–180 s |
| **L2 anclado** | busca en la base primero, responde **solo** con eso y cita `[n]` | **9/12** | **4–8 s** |
| L3 verificado | L2 + juez por afirmación; entrega solo lo sustentado | 7/12 | 20–50 s |

`extract` descompone la respuesta en afirmaciones atómicas (máx. 15) y el juez decide `SUSTENTADA`,
`CONTRADICHA` o `NO_VERIFICABLE` con una cita literal de la fuente (`pipeline_verify.py`).

## Lo que mostró

- **Sin base, el modelo inventa códigos.** L0 dijo que P0301 es "sensor de posición del cigüeñal"
  (es falla de encendido en el cilindro 1) y calculó RPM del PID 0C como `A × B`. Con la base (L2),
  ambas bien. Ante un código inexistente o un auto que no está en la base, L2 se abstiene; L0 inventa.
- **L2 pierde donde la base no llega**: preguntas generales y una de seguridad. La base tenía 15
  entradas (6 DTC, 8 PIDs, ELM327).
- **Atomizar empeora la respuesta entregada** (L3): fragmenta el texto, y cuando la fuente es breve
  deja frases vacías ("El código P0301 es un código de diagnóstico"). Sirve para **medir**, no para
  responder al usuario.
- **El auditor (L1) no mejora nada en vivo**: verifica después y cuesta 10–20 veces más.

## Antecedente en otro proyecto

En el vertical de salud de `~/src/qvac_node` (septiembre 2026) se probó un modelo chico como
controlador y un "cribado" previo que decidía si repreguntar: el cribado repreguntó en 6 de 6 casos y
el menú de acciones dio 0 de 3 respuestas. Conclusión de entonces: pedirle al modelo **qué** buscar,
no **si** buscar; y el "RAG invertido" (responder, luego buscar evidencia por afirmación) como
auditor, no como camino crítico. Ver `docs/REPLANTEO_ARQUITECTURA-AGENTES.md` de ese repo.
