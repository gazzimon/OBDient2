// The make from a VIN's first three characters (WMI, ISO 3780), so a module
// scan knows which make's addresses to try. Only WMIs we are sure of, with the
// plants that build for Argentina first; unknown → null (the assistant can
// pass the make the user said). Make names match the lab knowledge base.

const WMI: Record<string, string> = {
  // Volkswagen: Argentina, Brasil, México, Alemania
  '8AW': 'volkswagen',
  '9BW': 'volkswagen',
  '3VW': 'volkswagen',
  WVW: 'volkswagen',
  WVG: 'volkswagen',
  WV1: 'volkswagen',
  WV2: 'volkswagen',
  // Chevrolet / GM
  '8AG': 'chevrolet',
  '9BG': 'chevrolet',
  KL1: 'chevrolet',
  '1G1': 'chevrolet',
  '1GC': 'chevrolet',
  '1GN': 'chevrolet',
  '3G1': 'chevrolet',
  // Fiat
  '8AP': 'fiat',
  '9BD': 'fiat',
  ZFA: 'fiat',
  // Renault / Dacia
  '8A1': 'renault',
  '93Y': 'renault',
  VF1: 'renault',
  UU1: 'dacia',
  // Nissan
  '94D': 'nissan',
  '3N1': 'nissan',
  '3N6': 'nissan',
  JN1: 'nissan',
  JN8: 'nissan',
  VSK: 'nissan',
  // Peugeot / Citroën
  '8AD': 'peugeot',
  '936': 'peugeot',
  VF3: 'peugeot',
  '935': 'citroen',
  VF7: 'citroen',
  // Ford
  '8AF': 'ford',
  '9BF': 'ford',
  WF0: 'ford',
  '1FA': 'ford',
  '1FM': 'ford',
  '1FT': 'ford',
  '3FA': 'ford',
  // Toyota
  '8AJ': 'toyota',
  '9BR': 'toyota',
  // Honda, Hyundai, Kia, Jeep, Audi
  '93H': 'honda',
  JHM: 'honda',
  KMH: 'hyundai',
  KNA: 'kia',
  KND: 'kia',
  '988': 'jeep',
  '1C4': 'jeep',
  WAU: 'audi',
};

export function makeFromVin(vin: string | null | undefined): string | null {
  const v = (vin ?? '').trim().toUpperCase();
  if (v.length < 3) return null;
  const wmi = v.slice(0, 3);
  if (WMI[wmi]) return WMI[wmi];
  if (wmi.startsWith('JT')) return 'toyota'; // JTx: every Toyota Japan plant
  return null;
}
