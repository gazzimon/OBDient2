# ADR-0008 — Cuentas (Firebase) y acceso al modelo (new-api)

**Estado:** propuesta · 2026-10-18

## Contexto

El asistente de ADR-0007 llama a un modelo en la Z440. Hace falta:
- saber quién usa la app, para cuotas, soporte y borrado de datos;
- que la app no lleve una clave que dé acceso libre al modelo, porque el APK se puede extraer;
- que el acceso se pueda cortar por usuario sin afectar a los demás.

Hechos verificados (2026-10-18):
- new-api ya corre en la K16 y expone el modelo por el gateway de Caddy (`/llm`, a verificar en M0).
- La app se distribuye como APK; hoy no hay iOS en el plan.

## Decisión

1. **Identidad: Firebase Authentication.** Inicio de sesión con Google (Android) desde el primer
   arranque. Apple queda para cuando se publique en iOS, o en Android vía flujo web si hace falta.
2. **Acceso al modelo: new-api.** Cada cuenta de Firebase tiene un usuario de new-api con:
   - un token que solo puede usar el modelo de chat (lista blanca);
   - cuota y límite de velocidad por usuario.
   Un servicio chico, desplegado en la K16, crea el usuario y su token al registrarse, y los revoca
   si la cuenta se borra. Lo implementa el mismo servicio que valida el ID token de Firebase.
3. **Un token por cuenta, no por dispositivo.** Si el usuario cambia de teléfono, conserva su cuota.
4. **El token viaja en el APK solo en la forma de token de la cuenta**, obtenido después del login.
   No hay ninguna clave maestra en la app.
5. **Datos personales mínimos.** La cuenta guarda nombre, correo y proveedor de login. No se
   guardan VIN, patentes ni ubicación en Firebase.
6. **Comunidad:** foro externo (Discourse en la Z440 o la K16) con su propia cuenta, o un grupo de
   Discord mientras sea chico. No hay chat entre usuarios dentro de la app.

## Consecuencias

- Dos sistemas de identidad: Firebase (quién es el usuario) y new-api (qué puede consumir). El
  servicio que los conecta es el único punto nuevo que mantener.
- Dependencia de Google para el login. Si Firebase cae, no se puede iniciar sesión nuevo; las cuentas
  ya logueadas siguen con su token.
- Hay que decidir la política de borrado de cuenta (datos en el teléfono y en new-api) antes de
  publicar.
- La extracción de un token de cuenta sigue siendo posible. Los límites por cuenta lo acotan; no
  impiden el abuso total. Si hace falta más, se revisa con un ADR nuevo.

## Alternativas descartadas

- **Clave única en la app:** cualquiera que descompile el APK tiene acceso libre al modelo.
- **Cuenta de new-api que el usuario crea a mano:** mala experiencia y sin inicio de sesión
  unificado.
- **Supabase Auth:** válido, pero Firebase fue la preferencia del usuario y ya cubre Google y Apple.
