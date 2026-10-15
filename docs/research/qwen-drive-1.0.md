# Qwen-Drive-1.0: qué es y qué aprendimos

Fuente: *Qwen-Drive-1.0: An Initial Step towards a Vision-Language Foundation Model for Autonomous
Driving* ([arXiv 2609.00111](https://arxiv.org/abs/2609.00111), 31-08-2026). Pesos y código bajo
Apache-2.0. Leído el 2026-10-14. Las cifras se extrajeron por tramos: verificarlas en el PDF antes de
citarlas fuera de este repo.

## El modelo

- **Base:** Qwen3.5-4B sin cambios de arquitectura. Le añaden dos piezas:
  - **Cabeza BEV:** detección 3D, ocupación y mapa a partir de 6–8 cámaras calibradas, a 896×512.
  - **Planning Expert:** difusor de ~1,1B parámetros (32 capas, flow matching), condicionado por las
    caché K/V de la VLM.
- **Entradas del planificador:**
  - 3 cámaras (frontal, frontal-izquierda y frontal-derecha) en 4 instantes: el actual a 720p y 3
    históricos a 320p, separados 0,5 s;
  - historia de la trayectoria ego;
  - estado ego actual e instrucción de navegación, inyectados por *adaptive layer norm*.
- **No existe un "CAN Embedder [speed, accel]"**, al menos en lo leído. Los campos exactos del estado
  ego no se detallan.
- **Salida:** 50 puntos (x, y, θ) en el marco ego, es decir 5 s a 10 Hz. Se obtienen con 10 pasos de
  Euler.
- **Entrenamiento en 4 etapas:**
  1. cabeza BEV sola;
  2. cabeza + VLM juntos, con un 31 % de datos generales;
  3. planificador con la VLM congelada;
  4. RL (GRPO).
- **Resultados:**
  - NAVSIM PDMS 90,7 y WOD-E2E RFS 7,91;
  - QA de conducción +5,9 sobre la base, conservando la capacidad general (66,4 vs 67,4);
  - en bucle cerrado (AlpaSim) reduce a la mitad las salidas de carretera, pero queda detrás de
    Alpamayo-1.5 en el puntaje global.
- **No publica latencia ni hardware de inferencia.**

## Lecciones y cómo las aplicamos

| Lección del paper | Aplicación en OBDient2 |
|---|---|
| Mezclar datos generales evita el olvido catastrófico | Reentrenar el detector siempre con *replay* del dataset base, nunca solo con lo nuevo |
| Primero cabezas con el backbone congelado, luego todo junto | Mismo esquema para el fine-tuning del detector |
| El filtro de consistencia descartó el 44 % de los datos | El etiquetado automático debe descartar mucho; consenso entre detectores o revisión humana |
| Cambiar de configuración de cámaras degrada fuerte (16,5 NDS fuera de dominio) | Con 1 cámara de móvil, la cabeza BEV no sirve y el planificador está fuera de distribución. Qwen como narrador y etiquetador, no como medidor |
| Con configuraciones de cámaras no vistas, el resultado es "coherente" pero sin precisión 3D comprobada | Las distancias en la AR salen de nuestra calibración, no del modelo |
| La mejor de 6 trayectorias supera a la salida por defecto (91,4 vs 90,7) | La dispersión entre N muestras sirve como incertidumbre: si divergen, no se dibuja y el frame es "dudoso" |
| La historia escasa (4 frames a 0,5 s) limita la reacción | Nada reactivo depende de Qwen (ADR-0001) |
| El texto no siempre coincide con la trayectoria | No mostrar razonamiento y trayectoria como si fueran coherentes sin verificarlo |
| Confunde la causa cuando hay varias urgencias | La prioridad de las alertas es determinista |
| Penalizan el *jitter*; reconstruyen el rumbo con splines y filtros | La AR se suaviza en el tiempo; el ego-estado se filtra (ADR-0004) |
| La predicción "x" es robusta al ruido de sensores mezclados | Usarla si algún día entrenamos un planificador propio |
| El planificador mejora con más datos y no se satura | Grabar desde temprano clips con telemetría sincronizada, en un formato estable |
| "PDMS no es un proxy de conducción real" | Métricas propias sobre *replay* de viajes reales |
| La cabeza BEV es una "sonda" inspeccionable | Toda salida de IA debe poder visualizarse; la AR es esa sonda |

## Implicaciones para la integración (E5)

- **Entrada:** frames del buffer de cámara (1 cada 0,5 s), más `EgoEstimator.egoFrameHistory()`
  (x adelante, y izquierda, rumbo positivo a la izquierda), más la instrucción derivada de la
  próxima maniobra.
- **Conectividad:** datos móviles + VPN hacia la Z440. La app no depende de ello.
- **Experimento previo obligatorio:** vídeo del teléfono + GPS → Qwen-Drive en la Z440. Medir
  latencia, VRAM y dispersión de trayectorias con una sola cámara. Si la trayectoria no tiene sentido,
  Qwen queda solo para el modo diferido.
