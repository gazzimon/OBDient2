# Política de Privacidad — OBDient FIUI Socios

**Versión:** BORRADOR 0.1 · **Vigencia:** 28 de octubre de 2026
**Responsable del tratamiento:** Fundación Iniciativa Urbana Inteligente (FIUI), CUIT 30-71882909-3, con domicilio en Av. Uruguay 2651, Piso 1, Posadas, Misiones, CP 3300, Argentina.
**Contacto de privacidad:** fiui.org.ar@gmail.com
> Este documento es un borrador redactado con ayuda de una IA y **puede contener errores o afirmaciones inexactas** (incluidas las citas de normas, que no fueron verificadas contra el texto oficial). Debe ser revisado por una persona con conocimiento legal antes de publicarse o de actuar en base a él. Los campos entre corchetes deben completarse. Ver `revision-politica.md`.

---

## 1. Qué es esta aplicación y qué no es

OBDient FIUI Socios es una herramienta de diagnóstico para **mecánicos y talleres socios** de OBDient. Se conecta por Bluetooth a un adaptador OBD-II, lee datos del vehículo y ofrece un asistente de inteligencia artificial que ayuda a interpretarlos.

**La aplicación y su asistente no sustituyen a un mecánico, a un taller ni a un diagnóstico profesional.**

- Las respuestas del asistente las genera un modelo de inteligencia artificial. **Pueden ser incompletas o incorrectas.** Verificá siempre antes de actuar.
- La decisión de reparar, conducir, o dejar de conducir un vehículo es **siempre de la persona usuaria**, que responde por ella.
- La aplicación está diseñada para **leer** datos del vehículo. Borra códigos de falla solo si lo pedís y lo confirmás en pantalla. No escribe, reprograma ni desbloquea módulos de la unidad.
- Es una ayuda a la conducción: no reemplaza tu atención ni las señales de tránsito. No la manipules mientras conducís.

## 2. A quién va dirigida

A personas mayores de 18 años que actúan en carácter profesional (mecánicos y talleres socios). La distribución es privada (archivo APK entregado por OBDient). Si cargás datos de **vehículos o clientes de terceros**, sos responsable de contar con su autorización para hacerlo; ver sección 9.

## 3. Qué datos tratamos, para qué y con qué base

| Dato | De dónde sale | Para qué | Dónde queda |
|---|---|---|---|
| **Correo electrónico** | Lo ingresás al crear la cuenta | Identificarte, habilitar el asistente, enviarte el código de acceso | Servidor propio (Argentina) y proveedor de acceso (sección 6) |
| **Clave de acceso al asistente** | La genera el servidor | Autorizar tus consultas | Cifrada en el almacén seguro del teléfono (Android Keystore); en el servidor solo se guarda un hash |
| **Conversaciones con el asistente** (texto) | Lo que escribís o dictás y las respuestas | Responderte | En tu teléfono; el texto de cada consulta se envía a nuestro servidor para ser procesado |
| **Datos del vehículo** (velocidad, RPM, temperaturas, códigos de falla, VIN, módulos) | El adaptador OBD-II | Mostrártelos y contextualizar al asistente | En tu teléfono. Hacia el servidor solo sale el VIN **con los últimos 6 caracteres ocultos** |
| **Fotos** (tablero, etc.) | Solo si elegís enviar una | Que el asistente las interprete | Se envían al servidor con tu consulta |
| **Voz** | Micrófono, solo cuando lo activás | Convertir tu voz en texto | Ver sección 6 |
| **Ubicación precisa** | GPS, solo con la app en uso | Calcular rutas y guiarte | Las coordenadas de origen/destino se envían a nuestro servidor de rutas |
| **Seguimiento en vivo** (posición, velocidad, algunas lecturas OBD, 11 primeros caracteres del VIN, tu correo como conductor) | **Solo si lo activás vos en Ajustes** | Monitoreo del laboratorio de OBDient | Servidor propio; el dispositivo se identifica con un código seudónimo, no por la MAC del adaptador ni por el VIN |
| **Viajes y bitácora de servicio** | Los genera la app | Tu historial | Solo en tu teléfono, salvo que los compartas |
| **Lo habitual de cada auto** (ralentí, tensión, temperatura, consumo, por VIN) | Lo aprende la app mientras el adaptador está conectado | Comparar una lectura con el pasado del mismo auto en el diagnóstico | Solo en tu teléfono |
| **Sonido del motor** | Micrófono, solo cuando tocás "Grabar" o "Escuchar" | Comparar el motor con una grabación de referencia | Solo una huella numérica del sonido, en tu teléfono; **la grabación no se guarda ni se envía** |
| **Pruebas 0–100 y peso del auto** | Las hacés vos, con la velocidad del adaptador | Mostrarte tiempos y una potencia estimada | Solo en tu teléfono |
| **Informes PDF** | Los generás vos | Compartirlos con un taller o con el dueño del auto | En el teléfono hasta que los compartas; el VIN sale sin sus últimos 6 caracteres |
| **Aportes a la base técnica** (documentos, notas) | Solo si los agregás | Mejorar el asistente para el equipo | Servidor propio; ver sección 8 |

**Bases del tratamiento (Ley 25.326):** tu **consentimiento libre, expreso e informado** (art. 5) al registrarte y al activar funciones opcionales (seguimiento en vivo, fotos, voz, ubicación); y la **necesidad del tratamiento** para prestarte el servicio que pediste.

**No hacemos:** venta de datos, publicidad, perfilado comercial ni uso de tus conversaciones para entrenar modelos de terceros.

## 4. Dónde están tus datos y cómo los protegemos

- **Servidor propio en la República Argentina.** Los datos de tu cuenta, el procesamiento del asistente (modelo de lenguaje y transcripción de voz), el cálculo de rutas, la búsqueda de lugares y la base técnica corren en infraestructura de FIUI ubicada físicamente en Posadas, Misiones, Argentina (en el domicilio indicado arriba). No usamos servicios de IA en la nube de terceros para procesar tus consultas.
- **Cifrado en tránsito:** toda comunicación entre la app y el servidor usa HTTPS.
- **Minimización:** el VIN completo y el serial del vehículo no salen de tu teléfono; las posiciones compartidas en exportaciones se aproximan; la dirección del adaptador y tu correo se ocultan en los textos que se comparten o suben.
- **Almacén seguro:** la clave del asistente se guarda en el Keystore de Android, fuera de las copias de seguridad.
- **Control de acceso:** el acceso al servidor está limitado al personal autorizado del equipo de OBDient. [COMPLETAR: medidas organizativas, registro de accesos.]
- **Registros del servidor:** no registramos claves, consultas ni posiciones; solo eventos técnicos mínimos. [VERIFICAR contra la configuración real.]
- Ningún sistema es invulnerable. Aplicamos medidas técnicas y organizativas razonables, y si ocurriera un incidente que afecte tus datos, te lo notificaremos [PLAZO] y lo informaremos a la autoridad cuando corresponda.

## 5. Con quién compartimos datos

No vendemos ni cedemos tus datos. Solo intervienen:
1. **Proveedor de acceso por correo** (sección 6).
2. **Servicios de mapas:** los mosaicos del mapa se descargan de **OpenFreeMap** (datos de OpenStreetMap), lo que implica que ese servicio ve tu dirección IP y la zona que mirás.
3. **Búsqueda en internet** (si el asistente busca por vos): nuestro buscador propio consulta motores externos y páginas públicas **con el texto de la consulta**, sin tu identidad. Evitá incluir datos personales en preguntas que impliquen buscar en la web.
4. **Autoridades**, únicamente ante requerimiento legal válido.

## 6. Transferencias internacionales y servicios de terceros

- **Inicio de sesión por código (Magic):** el envío del código a tu correo lo realiza un proveedor externo ubicado fuera de la Argentina [CONFIRMAR país y condiciones]. Le llega tu correo. La transferencia se ampara en tu consentimiento y en [cláusulas contractuales conformes a la Disposición AAIP 60-E/2016 — CONFIRMAR].
- **Dictado por voz:** [CONFIRMAR cuál motor usa cada función]. El dictado puede hacerse con el reconocimiento de voz del propio teléfono (que en Android puede ser un servicio de Google, sujeto a su política) o con nuestro servidor propio. La app te indica cuál se usa antes de grabar. No grabamos audio de forma permanente.

## 7. Cuánto tiempo conservamos tus datos

| Dato | Plazo |
|---|---|
| Cuenta y clave | Hasta que borres tu cuenta |
| Conversaciones, viajes, fallas, bitácora | En tu teléfono, hasta que los borres o borres tu cuenta |
| Seguimiento en vivo | 7 días; luego el equipo lo borra de Traccar |
| Páginas web leídas por el asistente | 30 días |
| Aportes a la base técnica | Hasta que los borres vos (o anonimizados, sección 8) |
| Registros técnicos del servidor | 30 días |

## 8. Tus derechos y cómo ejercerlos

Conforme a la Ley 25.326, tenés derecho a **acceder, rectificar, actualizar y suprimir** tus datos, y a revocar tu consentimiento en cualquier momento. El acceso es gratuito a intervalos no inferiores a seis meses, salvo interés legítimo acreditado (art. 14).

**Borrar tu cuenta (dentro de la app):** Ajustes → Cuenta → *Borrar cuenta*. Esto:
1. Borra tu cuenta y revoca tu clave del asistente.
2. Borra de tu teléfono tus conversaciones, viajes, historial de fallas, bitácora de servicio, lo aprendido de cada auto, las referencias de sonido del motor y las pruebas 0–100.
3. Hace que tus aportes a la base técnica compartida **dejen de figurar a tu nombre** (se anonimizan). El contenido técnico se conserva porque pertenece al conocimiento común del laboratorio y no contiene datos personales; si querés que además se elimine, pedilo (punto siguiente).

**Si no podés usar la app** (perdiste el acceso, desinstalaste, o querés que se eliminen también tus aportes o tus datos de seguimiento): escribinos a **fiui.org.ar@gmail.com** desde el correo de tu cuenta. Responderemos en un plazo máximo de **10 días corridos** (arts. 14 y 16 de la Ley 25.326) y completaremos el borrado en servidores en un plazo máximo de 30 días.

**Autoridad de control:** la **Agencia de Acceso a la Información Pública (AAIP)**, órgano de control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos de quienes vean afectados sus derechos: <https://www.argentina.gob.ar/aaip>.

## 9. Responsabilidades de la persona usuaria profesional

Si usás la app sobre el vehículo de un cliente, sos quien decide qué datos de esa persona o vehículo se cargan. Debés contar con su autorización, informarle, y no usar la app para fines ilícitos. OBDient no se hace responsable por reparaciones, decisiones comerciales o daños derivados de un diagnóstico basado únicamente en la aplicación.

## 10. Seguridad del vehículo

La aplicación restringe por diseño los comandos que envía al vehículo a operaciones de lectura. Aun así, conectar cualquier dispositivo a un vehículo conlleva riesgos. Usá un adaptador de calidad, con el vehículo detenido para operaciones de diagnóstico, y asumí la responsabilidad por la conexión.

## 11. Cambios en esta política

Si cambiamos esta política de forma sustancial te lo avisaremos en la aplicación antes de que se aplique. La versión vigente estará siempre en [URL PÚBLICA].

## 12. Contacto

Fundación Iniciativa Urbana Inteligente (FIUI) · CUIT 30-71882909-3 · Av. Uruguay 2651, Piso 1, Posadas, Misiones, CP 3300 · fiui.org.ar@gmail.com
