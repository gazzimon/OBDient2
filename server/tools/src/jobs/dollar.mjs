// Dollar rates in Argentina (dolarapi.com: oficial, blue, MEP, CCL, tarjeta…).
// Not an official source; "oficial" there follows the Banco Nación board.

export const DOLLAR_URL = 'https://dolarapi.com/v1/dolares';

export function ratesFromApi(list) {
  return (Array.isArray(list) ? list : [])
    .filter((d) => typeof d?.casa === 'string' && (d.venta > 0 || d.compra > 0))
    .map((d) => ({ kind: d.casa, name: d.nombre, buy: d.compra ?? null, sell: d.venta ?? null, updated: d.fechaActualizacion ?? null }));
}
