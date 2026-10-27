# Decisiones de arquitectura

Cada decisión vive en un ADR con estado y fecha. Reglas, para que nada quede desactualizado:

- **Estados:** `propuesta` → `aceptada` → (`reemplazada por ADR-NNNN` | `obsoleta`).
- **Un ADR no se reescribe** cuando cambia la decisión: se escribe uno nuevo que dice qué reemplaza,
  y el viejo solo cambia su estado a `reemplazada por ADR-NNNN`.
- **Un ADR no tiene detalles de implementación que cambian**: versiones, endpoints, nombres de
  archivo y números de medición van en `docs/ROADMAP.md` o en la documentación técnica, que sí se
  actualiza.
- **Cada ADR tiene fecha** de su último cambio de estado.

| # | Título | Estado |
|---|---|---|
| [0001](0001-local-autonoma-servidor-opcional.md) | La app es autónoma; el servidor es ayuda opcional | aceptada |
| [0002](0002-stack-expo-react-native.md) | Expo / React Native, reutilizando OBDient | aceptada |
| [0003](0003-mapas-rutas-y-licencias.md) | Mapas, rutas y licencias para distribuir | aceptada |
| [0004](0004-proyeccion-ar-y-fusion.md) | Proyección AR y fusión de sensores | aceptada |
| [0005](0005-deteccion-maestro-alumno-multicamara.md) | Detección: maestro en la Z440, alumno en el teléfono, varias cámaras | aceptada |
| [0006](0006-z440-turnos-de-gpu.md) | Z440: una GPU en línea, una GPU para lotes | aceptada |
| [0007](0007-asistente-conversacional-en-el-telefono.md) | Asistente conversacional: el loop en el teléfono, el modelo en el servidor | aceptada |
| [0008](0008-cuentas-y-gateway-del-asistente.md) | Cuentas (correo con código) y acceso al modelo (new-api) | aceptada |
| [0009](0009-gemelo-del-adaptador-modo-laboratorio.md) | Gemelo del adaptador: modo laboratorio con OBDient como puente (M9) | propuesta, después de la navegación |
| [0010](0010-memoria-del-asistente-en-el-telefono.md) | La memoria del asistente vive en el teléfono; sin Honcho por ahora | aceptada |
| [0011](0011-privacidad-del-vin-y-del-recorrido.md) | El VIN y el recorrido no salen del teléfono con la identidad del auto | aceptada |
| [0012](0012-busqueda-con-evidencia.md) | La búsqueda devuelve evidencia, no migajas | aceptada |
