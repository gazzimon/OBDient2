# ADR-0008 — Cuentas (correo con código) y acceso al modelo (new-api)

**Estado:** propuesta · 2026-10-18 (revisada el mismo día: token por cuenta; identidad con Magic en lugar de Firebase)

## Contexto

El asistente de ADR-0007 llama a un modelo en la Z440. Hace falta:
- saber quién usa la app, para cuotas, soporte y borrado de datos;
- que la app no lleve una clave que dé acceso libre al modelo, porque el APK se puede extraer;
- que el acceso se pueda cortar por usuario sin afectar a los demás.

Hechos verificados (2026-10-18):
- new-api ya corre en la K16 y expone el modelo por el gateway de Caddy (`/llm`, a verificar en M0).
- La app se distribuye como APK; hoy no hay iOS en el plan.
- new-api (v1.0.0-rc.42) solo crea tokens para el usuario que llama: un administrador no puede
  crearle tokens a otro usuario. Hacerlo en nombre de cada cuenta exige iniciar sesión como ella, con
  los límites de frecuencia y el captcha del login (2026-10-18).

## Decisión

1. **Identidad: correo con código (Magic, plan gratuito).** El usuario escribe su correo y recibe un
   código; en un teléfono nuevo, Magic además pide aprobarlo por correo. Sin contraseñas ni cuentas de
   Google. Magic manda los correos: no hace falta dominio ni servidor de correo propios.
   - La cuenta se identifica por el **correo**, no por el identificador de Magic: si se cambia de
     proveedor, cada persona conserva su clave del modelo.
   - La app usa una interfaz de identidad (`IdentityPort`); Magic está en un solo archivo.
   - **Migración prevista:** a Supabase Auth (código abierto, se puede alojar en la K16) si se superan
     los 1.000 usuarios activos por mes del plan gratuito de Magic.
2. **Acceso al modelo: new-api, un token por cuenta.** Todas las cuentas viven bajo un usuario de
   servicio de new-api (`obdient2app`). Cada cuenta tiene **un token** con:
   - lista blanca: solo el modelo de chat;
   - cuota propia; deshabilitar el token corta a esa cuenta sin afectar a las demás.
   Un servicio chico en la K16 (`server/auth`, detrás de Caddy en `/auth`) valida el token de la
   identidad, crea el token de la cuenta la primera vez y lo devuelve; lo borra si la cuenta se borra.
   El límite de pedidos por minuto de new-api es por usuario, así que acá es global para la app: el
   abuso de una cuenta se acota con su cuota. Si hace falta un límite por cuenta, va en el gateway.
3. **Un token por cuenta, no por dispositivo.** Si el usuario cambia de teléfono, conserva su cuota.
4. **El token viaja en el APK solo en la forma de token de la cuenta**, obtenido después del login.
   No hay ninguna clave maestra en la app.
5. **Datos personales.** La cuenta es el correo. El VIN y el histórico de fallas se podrán sincronizar
   por cuenta (destino a definir: Supabase o un servicio propio en la K16); el VIN identifica un auto y,
   con la cuenta, a su dueño: el borrado de la cuenta borra también estos datos. No se guardan patentes
   ni ubicación.
6. **Comunidad:** foro externo (Discourse en la Z440 o la K16) con su propia cuenta, o un grupo de
   Discord mientras sea chico. No hay chat entre usuarios dentro de la app.

## Consecuencias

- Dos sistemas de identidad: Magic (quién es el usuario) y new-api (qué puede consumir). El servicio
  que los conecta es el único punto nuevo que mantener.
- Dependencia de Magic para entrar. Si Magic cae, no se puede iniciar sesión nuevo; las cuentas ya
  logueadas siguen con su clave. Magic crea una billetera por usuario que no usamos (su modelo de
  negocio); cuesta US$0,045 por usuario activo por mes pasados los 1.000.
- Hay que decidir la política de borrado de cuenta (datos en el teléfono y en new-api) antes de
  publicar.
- La extracción de un token de cuenta sigue siendo posible. Los límites por cuenta lo acotan; no
  impiden el abuso total. Si hace falta más, se revisa con un ADR nuevo.

## Alternativas descartadas

- **Clave única en la app:** cualquiera que descompile el APK tiene acceso libre al modelo.
- **Cuenta de new-api que el usuario crea a mano:** mala experiencia y sin inicio de sesión
  unificado.
- **Firebase Authentication con Google** (implementado y retirado el 2026-10-18): exigía huellas SHA-1
  por build, `google-services.json` y Play Services, y Firebase no tiene código por correo (solo enlace,
  que en Android requiere App Links y dominio verificado).
- **Supabase Auth:** tiene código por correo y se puede alojar; queda como destino de migración.
- **Otros con billetera** (Privy, thirdweb, Dynamic, Coinbase CDP): mismo modelo de cobro por billetera
  sin ventaja para este uso.
