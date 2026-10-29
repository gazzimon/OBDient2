# M10 · Herramientas del taller

Fecha: 2026-10-28. Origen: comparación con DiagnostiX AI (`Documents/diagnostixAI`). Se tomaron
**ideas y estructura**, no contenido: causas, pesos, textos y frases son propios.

## Qué se hizo

| Pieza | Dónde | Notas |
|---|---|---|
| Motor de causas raíz | `src/domain/diagnosis/engine.ts`, `root-causes.ts` | Indicadores: código (con prefijos), sensor con condiciones (`when`), suma de sensores, síntoma (negado resta), desvío del baseline. Confianza = peso que se cumplió / peso que se pudo verificar. Lo no medible va a "qué medir". Solo códigos genéricos (P0, P2, B0, C0, U0). |
| Herramienta `diagnose` | `tools.ts`, `vehicle-tool-adapter.ts` | Lee códigos guardados y pendientes, muestrea 6 s los PIDs que usan las causas, suma el baseline. Sin adaptador, solo síntomas. |
| Lo habitual de cada auto | `src/domain/vehicle/baseline.ts`, `presentation/services/baseline-recorder.ts` | Por VIN (sin VIN no aprende: un mecánico conecta muchos autos). Un valor por sesión y medida (Welford, peso máximo 30). Desvío: ≥ 3 sesiones, 2,5 desvíos y más que el piso de la medida. |
| Informe PDF | `src/domain/report/diagnostic-report.ts`, `presentation/services/diagnostic-report.ts`, `app/report.tsx` | HTML con CSS en línea → `expo-print` → hoja de compartir. Fondo blanco. VIN sin los últimos 6. |
| Prueba 0–100 | `src/domain/performance/acceleration.ts`, `app/performance.tsx` | Arranca y termina sola con la velocidad OBD (cada muestra, vía `container.onObdSpeed`); avisa por voz. Potencia en rueda estimada (m·a + rodadura + aire)·v, ±20 %. |
| Sonido del motor | `src/domain/sound/engine-sound.ts`, `app/engine-sound.tsx` | 8 s a 16 kHz. Bandas relativas, irregularidad y envolvente (el micrófono corta los graves): frecuencia de encendido rpm/60·cil/2 y energía cada dos vueltas (índice de falla). Solo se guarda la huella. |
| Frases | `phrase-router.ts` | "datos en vivo", "mostrame los sensores", "diagnosticá", "haceme un diagnóstico". |
| Síntomas | `symptoms.ts` | Frenos, rulemán, homocinética, suspensión, dirección, embrague, A/C, forzador, testigos de ABS, airbag, TPMS y DPF. |

## Pendiente

- [ ] **APK nuevo**: `expo-print` es un módulo nativo; sin rebuild el botón del informe falla.
- [ ] Probar en el auto: el baseline necesita 3 conexiones con VIN antes de opinar; revisar que el
      ralentí y la tensión de carga queden en valores lógicos.
- [ ] Ajustar pesos con casos reales (el historial de fallas y los informes sirven de base).
- [ ] Sonido: validar con un motor con falla de encendido real y con el teléfono en distintos lugares.
- [ ] 0–100: comparar contra un cronómetro GPS; ver si la tasa de velocidad del B14 (sin STPX) alcanza.
- [ ] Revisión legal de la política con las filas nuevas (micrófono para el motor, datos locales).
