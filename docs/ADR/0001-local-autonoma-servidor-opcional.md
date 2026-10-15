# ADR-0001 — La app es autónoma; el servidor es ayuda opcional

**Estado:** aceptada · 2026-10-14

## Contexto

El plan original ponía a Qwen-Drive-1.0 (VLM de ~5.6B, BF16) en una Z440 con 2×RTX 3090 como cerebro
de la conducción. Al revisarlo aparecieron tres problemas:

1. **En el auto no hay "WiFi local".** La Z440 está en casa. Mientras se conduce solo se llega por
   datos móviles + VPN, con 50–150 ms de RTT y jitter, y a veces sin cobertura.
2. **El modelo espera otra entrada.** Usa 3 cámaras frontales (frontal, frontal-izquierda y
   frontal-derecha) y 4 instantes separados 0,5 s. El teléfono da una sola cámara: estamos fuera de su
   distribución de entrenamiento. El paper tampoco publica latencia de inferencia.
3. **Su historia visual es escasa.** Según el propio paper, eso limita la reacción en bucle cerrado.
   No sirve para nada reactivo.

## Decisión

- La app navega y dibuja la AR **sin red y sin servidor**: GPS + IMU + cámara bastan; el OBD mejora.
- Una ruta ya calculada **sigue guiando sin conexión**. Solo el recálculo necesita red.
- Qwen-Drive entra más adelante (E5) como **ayuda opcional cuando hay conexión** (4G/5G o WiFi):
  - **Modo diferido (prioritario):** subir clips y telemetría con WiFi para revisar el viaje
    (trayectoria del modelo frente a la conducida) y etiquetar datos para el detector local.
  - **Modo casi en vivo (extra):** enviar 1 frame cada 0,5 s. La respuesta se usa solo si llega dentro
    de su ventana de vigencia; si no, se descarta.
- El ego-estimador ya mantiene la historia de poses en el marco ego en el formato del planificador
  (x adelante, y izquierda, rumbo positivo a la izquierda). Así el modo servidor no necesita un
  segundo estimador.

## Consecuencias

- Toda lógica crítica vive en el dispositivo y es determinista (`src/domain`).
- El servidor se puede retrasar o cambiar de modelo sin tocar la experiencia básica.
- Antes de E5 hay que medir con un vídeo real: la latencia en la Z440 y la dispersión de las
  trayectorias muestreadas con una sola cámara.
