// Fuel consumption from the mass air flow (MAF): the app computes it, the
// model only reads the result. Assumes gasoline at the stoichiometric mixture
// (14.7 g of air per g of fuel, 0.74 kg/L): an estimate, close at steady
// cruise and idle, high under enrichment (full throttle, cold engine).

const AIR_FUEL_RATIO = 14.7;
const GASOLINE_G_PER_L = 740;

export interface FuelEstimate {
  readonly litersPerHour: number;
  // Only when the car is moving: per 100 km at the current speed.
  readonly litersPer100Km: number | null;
  readonly assumption: string;
}

export function fuelFromMaf(mafGramsPerSecond: number, speedKmh: number | null): FuelEstimate {
  const litersPerHour = (mafGramsPerSecond * 3600) / (AIR_FUEL_RATIO * GASOLINE_G_PER_L);
  const moving = speedKmh != null && speedKmh > 5;
  return {
    litersPerHour: Math.round(litersPerHour * 100) / 100,
    litersPer100Km: moving ? Math.round((litersPerHour / speedKmh) * 100 * 10) / 10 : null,
    assumption: 'nafta, mezcla estequiométrica 14,7:1; estimado desde el MAF',
  };
}
