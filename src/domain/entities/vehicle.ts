// Represents the connected vehicle and its detected OBD protocol.

export type OBDProtocol =
  | 'AUTO'
  | 'SAE_J1850_PWM'
  | 'SAE_J1850_VPW'
  | 'ISO_9141_2'
  | 'ISO_14230_4_KWP'
  | 'ISO_14230_4_KWP_FAST'
  | 'ISO_15765_4_CAN_11BIT_500K'
  | 'ISO_15765_4_CAN_29BIT_500K'
  | 'ISO_15765_4_CAN_11BIT_250K'
  | 'ISO_15765_4_CAN_29BIT_250K'
  | 'SAE_J1939'
  | 'UNKNOWN';

export interface Vehicle {
  readonly id: string;
  readonly make: string;
  readonly model: string;
  readonly year: number | null;
  readonly vin: string | null;
  readonly manufacturer: string | null; // full legal name, e.g. "General Motors De Argentina Srl"
  readonly plantCountry: string | null;
  readonly protocol: OBDProtocol;
  readonly adapterAddress: string;
  readonly connectedAt: Date;
}

// Creates a minimal Vehicle from an adapter address when VIN/make are not yet known
export function createUnknownVehicle(adapterAddress: string, protocol: OBDProtocol): Vehicle {
  return {
    id: `${adapterAddress}-${Date.now()}`,
    make: 'Unknown',
    model: 'Unknown',
    year: null,
    vin: null,
    manufacturer: null,
    plantCountry: null,
    protocol,
    adapterAddress,
    connectedAt: new Date(),
  };
}
