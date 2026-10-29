# M11 · Conexión y primera vez

Fecha: 2026-10-29. Origen: observaciones de los socios. La app no volvía a conectarse sola, no se veía qué
adaptador ni qué cuenta estaban activos, y entrar o salir de la cuenta solo se podía desde Ajustes.

## Qué se hizo

| Pieza | Dónde | Notas |
|---|---|---|
| Reconexión automática | `src/domain/obd/reconnect-policy.ts`, `presentation/services/connection-keeper.ts` | Antes había un solo intento al abrir la app, y si fallaba no volvía a probar. Ahora prueba al abrir la app, al volver a ella y al encender el Bluetooth. Después de un corte espera 5 s, 15 s, 30 s y luego cada minuto, solo con la app en pantalla. "Desconectar" frena los reintentos hasta la próxima conexión o hasta reiniciar la app. Mientras el usuario busca otro adaptador, no reintenta. Nunca abre el diálogo de permisos de Android por su cuenta (`hasPermissions`). |
| VIN al conectar | `connection-keeper.ts` → `obdStore.vin` | Se lee 4 s después de conectar. Lo usan la barra y la ficha del auto. |
| Barra de estado | `presentation/components/layout/TopStatusBar.tsx`, `domain/obd/link-status.ts` | A la izquierda, el adaptador y el auto ("OBDII B35 · Chevrolet 2024"). El punto aparece relleno, como anillo o hueco según el estado, no solo por color. A la derecha, la cuenta. Cada lado abre una hoja con sus acciones: desconectar, buscar de nuevo, elegir otro, cerrar sesión, entrar. "Borrar cuenta" queda en Ajustes. La barra se esconde con el teléfono de costado. |
| Ficha del auto | `src/domain/vehicle/car-brief.ts`, `prompt.ts`, `hooks/assistantContext.ts` | Contiene la marca y el año por el VIN, los códigos de la última lectura, los que tuvo, el último borrado, los últimos 2 service y cuánto aprendió de lo habitual. Viaja con el mensaje solo si no está en los últimos 8 mensajes o si cambió. Si el auto es otro, avisa "[cambió el auto]". No entra en los resúmenes. El VIN va enmascarado. |
| Onboarding | `presentation/components/onboarding/Onboarding.tsx` | Son 4 pasos: bienvenida y seguridad, cuenta, adaptador (guía + búsqueda + "no apareció"), listo. El último paso resume lo hecho y ofrece permitir ubicación y cámara, con atajos para empezar. Reemplaza a `DisclaimerGate`, `PermissionsIntro` y `AccountGate`. Las instalaciones anteriores no lo ven. Se puede volver a ver desde Ajustes. |
| Dónde estacioné | `src/domain/parking/parking.ts`, `presentation/services/parking-recorder.ts`, `components/map/ParkedCard.tsx` | Cuando se corta el Bluetooth con el adaptador, guarda la posición del teléfono. Toma la de la navegación si es de los últimos 2 min; si no, pide una nueva (solo con la app en pantalla) o usa la última conocida. Descarta posiciones de más de 10 min o con más de 300 m de error. Guarda una por auto (VIN) y hasta 20 en total, solo en el teléfono. En Ruta aparecen el botón P, el marcador y una tarjeta con hace cuánto, distancia y dirección, "Ir caminando" (abre la app de mapas) y "Ya lo encontré". El asistente tiene `where_parked`, que también funciona sin conexión con "¿dónde estacioné?". "Llevame" usa `set_destination` 1. |
| Búsqueda compartida | `hooks/useAdapterScan.ts`, `components/obd/AdapterList.tsx` | La usan Vehículo y el onboarding. |

## Pendiente

- [ ] Probar en el teléfono que el inicio de sesión de Magic se vea. Su pantalla se dibuja debajo de cualquier `Modal`, así que el onboarding y la hoja de cuenta se ocultan mientras dura el ingreso.
- [ ] Probar la reconexión con el auto apagado al abrir la app, con contacto después, al alejarse y volver, y con el Bluetooth apagado y luego encendido.
- [ ] Revisar que las pantallas no dejen un espacio extra arriba ahora que la barra ocupa la zona segura (en Ruta, el mapa empieza debajo de la barra).
- [ ] Dónde estacioné: probar con el auto apagado con la app abierta, con la app en segundo plano (Android no da una posición nueva y se usa la última conocida) y alejándose con el teléfono.
- [ ] Tarjeta de "Primeros pasos" en Vehículo (primer informe, sonido de referencia): no se hizo.
