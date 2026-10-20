# Modo navegación — UX/UI y plan de implementación (2026-10-19)

Rediseño de la vista de manejo con el mapa 3D como vista principal (la cámara quedó en pausa, ver
ROADMAP *Decisión 2026-10-19*). Requisitos: **gama baja**, *keep it simple*, todo usable con una mirada
de menos de 2 s y un toque, nada que escribir en movimiento.

## 1. Qué hacen los productos de referencia

| Producto | Lo que conviene copiar | Lo que no |
|---|---|---|
| **Sygic** (capturas 2025) | Cartel de maniobra grande arriba (flecha, distancia, calle, y a la derecha la siguiente); velocidad actual + límite juntos abajo a la derecha; barra inferior fija `buscar · 13 min / 5,1 km · 14:47 · ⋯`; el `⋯` abre una hoja de **acciones rápidas** (info de ruta, sonido, agregar parada, ajustes, compartir) con **Cancelar ruta** grande y rojo al final; chips de nafta a la izquierda con la distancia | Vista de cruce 3D, carriles, monumentos 3D (datos que no tenemos), demasiados íconos de reportes |
| **Google Maps** | Columna vertical de botones redondos a la derecha (micrófono, buscar, sonido, brújula, reportar); "Recentrar" aparece solo si moviste el mapa; barra inferior `✕ · 36 min · 34 km 12:30 · rutas`; "Luego ↰" bajo el cartel | Reportes de la comunidad (no tenemos comunidad) |
| **Mockups genéricos** | Tarjeta de destino abajo con ETA y distancia antes de arrancar | Paneles de color grandes: tapan mapa sin aportar en movimiento |

Pautas de distracción (NHTSA / Android Auto): tareas en movimiento de toques simples, blancos ≥ 48 dp
(usamos **56–64 dp**), contraste alto, modo noche, sin teclado, voz como entrada principal.

## 2. Pantalla en movimiento

```
┌──────────────────────────────────────────────┐
│ ↱  200 m                        luego ↰      │  1 Cartel de maniobra (siempre)
│    Av. Mitre                                 │
├──────────────────────────────────────────────┤
│ (🎤)                                         │  2 Riel izquierdo: 🎤 grande,
│ (🔊)                                         │    🔊 sonido (3 estados),
│ (⚠)          mapa 3D                         │    ⚠ alertas, ⊕ recentrar/2D-3D
│ (⊕)                                          │
│                 ▲ auto                       │
│ ⛽ 1,2 km                              (50)  │  3 Chip de cercanía (nafta)
│                                     47 km/h  │  4 Velocidad + límite
├──────────────────────────────────────────────┤
│ ✕ │   13 min · 5,1 km · llega 14:47   │ ⋯    │  5 Barra de viaje
└──────────────────────────────────────────────┘
```

1. **Cartel de maniobra**: flecha, distancia grande, calle; "luego ↰" si la siguiente está a < 150 m. Toque
   = repetir la instrucción en voz.
2. **Riel izquierdo**: en Argentina el conductor va a la izquierda y el soporte suele ir al centro; el
   borde izquierdo es el que la mano alcanza sin cruzar la pantalla (Google lo pone a la derecha, pensado
   para tomarlo con la mano derecha). Un ajuste permite pasarlo a la derecha.
   - **🎤 Hablar** (el más grande, 64 dp): el asistente, igual que el chat en movimiento.
   - **🔊 Sonido**, un toque cicla: *todo* → *solo alertas* → *silencio*; el ícono muestra el estado.
   - **⚠ Alertas**: abre un mini selector de qué avisa (velocidad, radares, detector cuando vuelva).
   - **⊕ Recentrar / 2D-3D**: si moviste el mapa, recentra; si no, alterna 3D ↔ 2D norte arriba.
   - **GPS**: no es un botón; un punto de estado en el ⊕ (verde / ámbar "señal débil" / rojo "sin GPS"),
     y un aviso en el cartel si se pierde más de 5 s.
3. **Chips de cercanía** (solo con dato real): nafta más cercana sobre la ruta con la herramienta de
   combustibles que ya tenemos. Toque = "¿desviar a la estación?" (sí / no).
4. **Velocidad**: actual (OBD, si no GPS) en un círculo; el **límite** al lado solo cuando se conoce. Pasado
   el límite +10 %: el círculo en rojo y un tono (no voz) cada 30 s como máximo.
5. **Barra de viaje**: ✕ termina (pide confirmación), ETA/km/hora de llegada, ⋯ abre la hoja.

**Hoja de acciones rápidas (⋯)**, en movimiento solo opciones de un toque:
`Ver toda la ruta` · `Agregar parada (nafta, comida…)` · `Evitar…` · `Sonido` · `Ajustes de navegación`
· **`Terminar viaje`** (rojo, ancho completo, abajo).

**Estados**: *Preparando* (tarjeta de destino con ETA y `Iniciar`), *Navegando*, *Fuera de ruta*
("Recalculando…" en el cartel), *Sin conexión* (aviso fino arriba; la ruta calculada sigue), *Llegaste*
(tarjeta con duración, km, consumo si hay OBD, `Terminar`), *Manejo libre* (sin cartel; velocidad, calle
actual, riel).

**Orientación**: el diseño funciona en vertical y horizontal (en horizontal, el cartel pasa a la columna
izquierda y el mapa ocupa el resto). Se sigue la del teléfono.

## 3. Tus propuestas y las de los productos, evaluadas

| Idea | Viabilidad con nuestro stack | Decisión |
|---|---|---|
| **Evitar multas** | Límite de velocidad: OSRM **no** lo devuelve (probado: `annotations=maxspeed` inválido). Hay que extraer `maxspeed` del mismo OSM de Argentina a una tabla y servirlo por `obdient-tools` (por tramo de la ruta). Radares: `highway=speed_camera` del OSM, mismo camino. Cobertura en Argentina parcial: mostrar solo lo conocido. Legalidad de avisar radares: **verificar** antes de publicar | **Sí**, F3 |
| **Evitar embotellamientos** | No tenemos tránsito en vivo (OSRM es estático). Requiere un proveedor (HERE / TomTom, pago) | **Después**, con HERE (M8) |
| **Ajustes de navegación** | `exclude=motorway` y `exclude=toll` **funcionan** en nuestro OSRM (probado). Más: voz, 2D/3D, noche, alertas | **Sí**, F2 |
| **Ventana emergente** | La hoja ⋯ y las confirmaciones (terminar, desviar a nafta) | **Sí**, F1–F2 |
| **Cerrar viaje** | ✕ en la barra + "Terminar viaje" en la hoja, con confirmación; tarjeta de resumen | **Sí**, F1 |
| **Mapas sin conexión** | MapLibre descarga regiones (paquetes offline), pero OpenFreeMap no es para descargas masivas: necesita **teselas propias en la Z440** (ya en el ROADMAP). La ruta sigue sin red; buscar y recalcular, no | **Sí**, F5, después de las teselas propias |
| **Pausa en las paradas** | Hecho en parte: desde hoy, detenido no se suma distancia fantasma (rumbo y posición quietos). Falta: el registro pausa tras 2 min quieto y el viaje se corta tras 15 min con el motor apagado (OBD) | **Sí**, F6, con *Mis viajes* |
| Compartir llegada | Necesita un servicio y un enlace público | Después |
| Carriles / vista de cruce | Datos de carriles del OSM escasos aquí; pesado | No |

## 4. Gama baja

- 3D con edificios **solo** si el teléfono rinde (medir fps los primeros 10 s; si < 24, pasar a 2D sin
  edificios y recordarlo). Interruptor "Mapa liviano" en Ajustes.
- Cámara/detector apagados por defecto (en pausa).
- Seguimiento del mapa a 4 Hz con interpolación (ya), nada por cuadro en JS.
- Pantalla siempre encendida solo en la vista de navegación.

## 5. Plan por fases

| Fase | Qué | Tamaño | Build |
|---|---|---|---|
| **F1 Esqueleto** | Cartel de maniobra con "luego", riel izquierdo (🎤, 🔊 tres estados, ⚠, ⊕ con punto de GPS), velocidad, barra de viaje con ✕ y confirmación, tarjeta de llegada, manejo libre; vertical y horizontal; ventana de cámara oculta por defecto | M | no |
| **F2 Hoja ⋯ y ajustes** | Ver ruta completa, Evitar autopistas/peajes (OSRM `exclude`), sonido, alertas, 2D/3D, noche, mapa liviano, Terminar viaje | M | no |
| **F3 Velocidad** | Tabla `maxspeed` + radares del OSM en `obdient-tools` (por tramo), límite en pantalla, tono al pasarse; medir cobertura en Posadas/CABA antes | M (servidor + app) | no |
| **F4 Paradas en ruta** | Chip de nafta más cercana sobre la ruta, agregar parada (OSRM con punto intermedio) | M | no |
| **F5 Sin conexión** | Teselas propias en la Z440 → descarga de región en el teléfono, aviso "mapa sin conexión" | L | quizás |
| **F6 Viajes** | Pausa automática en paradas, corte por motor apagado, resumen al llegar → base de *Mis viajes* | M | no |
| Después | Tránsito (HERE), compartir llegada, voz del asistente en manejo | — | — |

**Estado F1 (2026-10-19, código; falta verlo en el teléfono):** cartel con "luego" y toque para repetir;
riel izquierdo con 🎤 (el asistente escucha y **responde en voz** por el árbitro, prioridad más baja, y en
una tarjeta 12 s), 🔊 de tres estados (`VoiceArbiter.setMode`: todo / solo alertas / silencio, una
alerta crítica siempre habla) y 3D/2D con el punto de GPS; velocidad abajo a la derecha; barra con ✕
(confirma si hay ruta), tiempo · km · llegada y ⋯ (sonido, 3D/2D, Terminar viaje); manejo libre; sin
cámara salvo con el ajuste "Cámara en manejo" (entonces horizontal fija, como antes); orientación libre.
El botón ⚠ pasa a F3 (sin velocidad ni detector no hay qué elegir).

Cada fase se prueba en el teléfono con el APK standalone (o el Dev por cable) antes de la siguiente.
F1 y F2 no necesitan build: son JS.

## 6. Decisiones abiertas

1. ¿Orientación: seguir la del teléfono (propuesta) o fijar una?
2. ¿Empezamos F1 antes o después de la prueba manejando con el APK actual?
3. Avisos de radar: ¿se incluyen sujetos a verificar la legalidad?
