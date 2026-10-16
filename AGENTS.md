# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.
For third-party native libraries (MapLibre v11, react-native-ble-plx), the installed TypeScript
declarations in `node_modules/<pkg>/lib/typescript` are the source of truth — their APIs changed
between majors.

---

# Mapa de documentación

- **Qué es y cómo correrlo:** [README.md](README.md)
- **Trayectoria por etapas (E0 → E6) y estado:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Decisiones de arquitectura:** [docs/ADR/](docs/ADR/README.md)
- **Adaptador OBD (B33 / familia STN), comandos y banco:** [docs/hardware/adaptador-stn.md](docs/hardware/adaptador-stn.md)
- **Investigación de fondo (Qwen-Drive-1.0):** [docs/research/qwen-drive-1.0.md](docs/research/qwen-drive-1.0.md)

# Reglas del proyecto

- **La app funciona sola.** GPS + IMU + cámara bastan para navegar con AR. El OBD mejora (velocidad,
  compensación de aceleración) y el servidor (Qwen-Drive) es ayuda opcional cuando hay conexión.
  Nada crítico puede depender de la red. Ver ADR-0001.
- **El dominio es puro.** `src/domain/**` no importa React, Expo ni librerías nativas; todo lo
  geométrico/numérico se testea con Jest (`npm test`). La UI solo pinta lo que el dominio calcula.
- **Distribuible.** Antes de añadir una dependencia, revisar su licencia (nada GPL/AGPL en la app).
  Los servidores públicos de demo (OSRM, Photon) son solo para desarrollo. Ver ADR-0003.
- **Medir, no suponer.** Capacidades de adaptadores, FOV de cámara, tasas de muestreo: se sondean o
  calibran en el dispositivo y se muestran en la UI.
- Verificación mínima antes de commitear: `npm run typecheck && npm test && npm run lint`.
