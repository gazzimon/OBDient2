// Declared capabilities of the adapters we evaluate.
//
// Everything here comes from vendor quotes/datasheets and is UNVERIFIED until
// the adapter bench has run against the hardware (`verified: false`). Code must
// not assume a claimed capability — probe, then trust the probe.

import type { OBDProtocol } from '@/domain/entities/vehicle';

// How UDS (ISO 14229) requests reach the ECU:
//   none      – OBD-II only
//   raw-isotp – ATSH/ATCRA + hex payload; the adapter does ISO-TP (ELM327/STN)
//   at-ur     – vendor AT UDS / AT UR command set (Starcharm B33-U)
export type UdsMode = 'none' | 'raw-isotp' | 'at-ur';

export interface AdapterCapabilities {
  protocols: readonly OBDProtocol[];
  mscan: boolean;
  swcan: boolean;
  j1939: boolean;
  uds: UdsMode;
  stnCommands: boolean;
}

export interface AdapterProfile {
  id: string;
  label: string;
  capabilities: AdapterCapabilities;
  verified: boolean;
  notes: string;
}

const CAN_PROTOCOLS: readonly OBDProtocol[] = [
  'ISO_15765_4_CAN_11BIT_500K',
  'ISO_15765_4_CAN_29BIT_500K',
  'ISO_15765_4_CAN_11BIT_250K',
  'ISO_15765_4_CAN_29BIT_250K',
];

const base: AdapterCapabilities = {
  protocols: CAN_PROTOCOLS,
  mscan: false,
  swcan: false,
  j1939: false,
  uds: 'raw-isotp',
  stnCommands: false,
};

export const GENERIC_PROFILE: AdapterProfile = {
  id: 'generic-elm327',
  label: 'Generic ELM327',
  capabilities: { ...base },
  verified: false,
  notes: 'Fallback when the adapter is unknown. Assumes CAN only.',
};

export const ADAPTER_PROFILES: readonly AdapterProfile[] = [
  GENERIC_PROFILE,
  {
    id: 'starcharm-b22',
    label: 'Starcharm B22 (BLE 5.0, 25K80)',
    capabilities: { ...base },
    verified: false,
    notes: 'Quote lists HSCAN only.',
  },
  {
    id: 'starcharm-b14',
    label: 'Starcharm B14 (BLE 5.0, 25K80)',
    capabilities: { ...base, mscan: true },
    verified: false,
    notes: 'Quote lists HSCAN + MSCAN.',
  },
  {
    id: 'starcharm-b33',
    label: 'Starcharm B33 (BLE 5.0, J1939, 24V)',
    capabilities: {
      ...base,
      protocols: [...CAN_PROTOCOLS, 'SAE_J1939'],
      j1939: true,
      stnCommands: true,
    },
    verified: false,
    notes:
      'Reference adapter for OBDient2. Quote lists J1939, 24V, sleep <1 mA; owner reports STN commands — confirmed at connect time by STI (see data/obd/stn.ts).',
  },
  {
    id: 'starcharm-b33u',
    label: 'Starcharm B33-U (UDS-OBD)',
    capabilities: { ...base, uds: 'at-ur' },
    verified: false,
    notes:
      'Vendor AT UDS/UDST/UR/URH/USID/RSID/UDSF/UDSN/UDSD. Response format is "suggested" in the datasheet — probe NRC 0x78 handling.',
  },
  {
    id: 'starcharm-b35',
    label: 'Starcharm B35 (BLE, STN-compatible "STN1040")',
    capabilities: { ...base, mscan: true, swcan: true, stnCommands: true },
    verified: true,
    notes:
      'Bench 2026-10-17 on a CAN 29/500 car: BLE confirmed; STI "STN1040 v1.3.6" (fw 2024-02-01, not an OBDLink part — vendor STN-compatible firmware), STDI "OBDII r3.1.3", no STSN. Speed 0D: STPX 24 Hz, 010D1 24 Hz, plain 15 Hz (BLE round-trip bound, ~41 ms). Sleeps after 600 s idle or <13 V for 3 h. MSCAN/SWCAN still unverified.',
  },
];

export function getAdapterProfile(id: string): AdapterProfile {
  return ADAPTER_PROFILES.find((p) => p.id === id) ?? GENERIC_PROFILE;
}
