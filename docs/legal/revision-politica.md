# Guía de revisión de la política (30 minutos)

Esto no es asesoramiento letrado: lo redacté contra el código del repo. Un abogado matriculado debe validarlo antes de publicar.

## A. Cosas que el borrador afirma y que TENÉS que confirmar vos (10 min)

| # | Afirmación | Cómo verificarla |
|---|---|---|
| 1 | "Servidor físicamente en Argentina" (ciudad/provincia) | Completar el dato real. K16 y Z440: ¿ambos en el mismo lugar? ¿hay copias de seguridad en la nube? Si las hay, **no** podés decir "solo en Argentina". |
| 2 | "No usamos IA de terceros en la nube" | Cierto según el código: el modelo es Qwen en la Z440 y la voz es Voxtral propio. Confirmar que no hay otra llamada saliente. |
| 3 | "No registramos claves, consultas ni posiciones" | El código lo declara en comentarios; revisá logs reales de `journalctl`, Caddy (access log) y Traccar, que **sí guarda posiciones** por diseño. |
| 4 | Dictado por voz | `app.json` lista `com.google.android.googlequicksearchbox` para reconocimiento: en Android puede ir a Google. Definir si el dictado usa Google o Voxtral y decirlo con precisión. |
| 5 | Seguimiento en vivo | El servidor asocia tu **correo** al conductor (`driverUniqueId`) en Traccar. El borrador lo declara. Si no querés eso, hay que cambiarlo en `server/tools/src/track.mjs`. |
| 6 | Magic (login) | Es un tercero fuera de Argentina que recibe el correo. Confirmar país, contrato y base de transferencia. |
| 7 | Plazos de retención | Completar los `[PLAZO]`. Traccar no borra por sí solo. |

## B. Obligaciones legales a cumplir fuera del texto (10 min)

1. **Inscribir la base de datos en la AAIP** (Ley 25.326, art. 21). Es obligación del responsable.
2. **Cláusulas / base para transferencia internacional** (art. 12; Disposición 60-E/2016 con cláusulas modelo) por Magic.
3. **Consentimiento informado** en la pantalla de registro: casilla expresa que enlace a esta política, sin pre-marcar.
4. **Aviso de privacidad dentro de la app** (Ajustes) y URL pública para Play/web. Aunque el APK sea privado, es lo correcto.
5. **Plan de respuesta a incidentes** con plazo de notificación.
6. **Términos de uso** aparte: limitación de responsabilidad y uso profesional.

## C. Lo que ya cumple el código (para la reunión con el abogado)

- Borrado de cuenta dentro de la app, con borrado local y anonimización de aportes (ver commit del borrado de cuenta).
- Seguimiento en vivo apagado por defecto y con consentimiento explícito (ADR-0011).
- VIN: serial nunca sale del teléfono; mascarado de MAC, correo y coordenadas en lo compartido.
- Clave del asistente en Keystore, `allowBackup` desactivado.
- Comandos al vehículo: lista de permitidos de solo lectura.

## D. Pendiente técnico que el texto todavía no puede prometer

- **Traccar:** no hay borrado automático al borrar la cuenta; hoy es por pedido manual (por eso el borrador lo ofrece por correo). Conviene automatizarlo.
- **MMKV sin cifrar** en el teléfono (chats, viajes). El texto dice "tu teléfono", no "cifrado en tu teléfono".
- **Base compartida:** `docs add` permite aportes de cualquier cuenta; con la versión socios y control del equipo, moderar antes de indexar.
- **Magic:** el correo sigue guardado en el proveedor; el borrado en la app no lo elimina allí. Pedirlo por su canal o migrar de proveedor.
