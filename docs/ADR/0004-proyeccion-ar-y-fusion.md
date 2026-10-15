# ADR-0004 — Proyección AR y fusión de sensores

**Estado:** aceptada · 2026-10-14

## Contexto

Dibujar la ruta sobre la calle exige saber, en cada instante, qué rayo de la cámara corresponde a
cada píxel. Eso requiere conocer la posición, el rumbo, el cabeceo y el alabeo de la cámara, además
de su campo de visión. Ningún sensor del teléfono da todo eso bien por sí solo:

- **GPS:** ~1 Hz, ruido de metros; el rumbo solo vale en movimiento.
- **Giroscopio:** suave y rápido, pero deriva.
- **Acelerómetro:** no distingue gravedad de aceleración. Frenar a 3 m/s² parece una inclinación
  de ~17°.
- **FOV:** no hay un valor fiable por dispositivo.

## Decisión

**Modelo** (`domain/ar/camera-model.ts`): cámara pinhole sobre un plano de calle local (ENU). La
intrínseca sale del FOV horizontal. La vista previa se fuerza a una caja 16:9 exacta, para que imagen
y overlay compartan coordenadas sin recortes desconocidos. Recorte en plano cercano de 2 m.

**Pose** (`domain/fusion/pose-estimator.ts`):

- Cabeceo y alabeo salen de la gravedad, **restando la aceleración del auto**: la longitudinal es la
  derivada de la velocidad OBD; la lateral, velocidad × tasa de giro. El resultado pasa por un filtro
  pasa-bajos (τ = 1,5 s), porque el soporte es rígido.
- El lado del landscape se deduce de la propia gravedad y no de la API de orientación de pantalla,
  para que no pueda contradecir al sensor que usamos.

**Ego-estado** (`domain/fusion/ego-estimator.ts`):

- **Rumbo:** se integra el giroscopio y se corrige hacia el rumbo GPS en movimiento. En reposo se
  siembra con el rumbo del primer tramo de la ruta.
- **Velocidad:** la OBD si está fresca, escalada por un factor OBD/GPS aprendido (los velocímetros
  leen unos % de más); si no, la del GPS.
- **Posición:** estima a estima entre fixes GPS. El salto de cada fix nuevo se absorbe en ~1 s, para
  que la AR nunca "salte".

**Calibración** (pantalla `calibrate`): offsets de cabeceo, alabeo y guiñada, más FOV, altura y signo
del sensor. Se ajustan con el auto quieto, alineando un horizonte, un carril de 3,5 m y marcas a
5/10/20/40 m.

**Progreso:** se calcula a ~10 Hz sobre la posición estimada. "Fuera de ruta" exige 4 s sostenidos
fuera de una banda de 35 m más la precisión del GPS.

## Consecuencias

- Toda la matemática está en el dominio y testeada. Hay tests de proyección, de compensación de
  frenada y de estima.
- **Supuestos a confirmar en el dispositivo:**
  - la convención de signo del acelerómetro en Expo/Android (`gravitySign`);
  - el mapeo de `rotationRate` (alpha/beta/gamma → z/x/y);
  - que `ratio="16:9"` produce exactamente la caja esperada.
  
  Todos son visibles en la calibración: el horizonte se mueve al revés o no coincide.
- La calle se supone plana. En pendientes fuertes la ruta lejana se desalinea. Una mejora futura es
  la elevación del terreno (DEM) o un horizonte detectado por visión.
