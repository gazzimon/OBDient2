# OBDient2

A driving companion for Android: turn-by-turn navigation, a live OBD-II dashboard and a voice
assistant that can read your car. Successor to OBDient.

**Status:** MVP, Android only. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Features

- **Drive mode**: 3D map navigation with voice guidance and rerouting.
- **Dashboard**: RPM, speed, coolant and battery gauges, with an optional camera view.
- **Assistant**: voice and text chat. It can search places, fuel prices and the web, and read
  fault codes and vehicle data.
- **Trips**: recorded automatically while the OBD adapter is connected. Includes a speed map, GPX
  export and optional live tracking (Traccar).
- **Diagnostics (lab)**: read-only module scan across HS/MS/SW-CAN. Writes, resets and flashing are
  blocked.

Supported adapters are ELM327/STN over BLE or classic Bluetooth, including the Starcharm B14, B33-U
and B35.

## Development

Requires a development build, because the app uses native modules and won't run in Expo Go.

```bash
npm install
npx eas build --profile development --platform android --local   # on a machine with enough RAM
npm start
```

Checks:

```bash
npm run typecheck && npm test && npm run lint
```

Trip logs:

```bash
npm run trips:pull                        # copy recorded trips from the phone (USB, dev build)
npm run replay -- trips/trip-XXXX.jsonl   # re-run sensor fusion offline
```

## Layout

```
src/
  domain/        pure logic, no React (navigation, fusion, OBD, assistant, trips)
  data/          adapters: OBD transport, sensors, routing, LLM, server tools
  presentation/  components and hooks
  app/           screens (expo-router)
server/          optional self-hosted services (routing, search, STT, LLM gateway, Traccar)
docs/ADR/        architecture decisions
```

## Maps and data

Map tiles come from OpenFreeMap/OpenMapTiles (© OpenStreetMap contributors), routing from OSRM and
geocoding from Photon. The default public servers are for development only. See
[ADR-0003](docs/ADR/0003-mapas-rutas-y-licencias.md) before distributing.
