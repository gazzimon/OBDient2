// Why an ECU refused a request: the code in "7F <service> <code>" (ISO 14229-1
// annex A.1; J1979 uses the same values). Spanish, for the model to relay.
export const NRC_REASONS: Readonly<Record<number, string>> = {
  0x10: 'rechazo general',
  0x11: 'el auto no soporta ese pedido',
  0x12: 'el auto no soporta esa variante del pedido',
  0x13: 'pedido mal formado',
  0x14: 'la respuesta sería demasiado larga',
  0x21: 'la ECU está ocupada; se puede repetir',
  0x22: 'condiciones no correctas (por ejemplo, el motor en marcha)',
  0x24: 'secuencia de pedidos incorrecta',
  0x25: 'un componente no respondió',
  0x26: 'una falla impide hacerlo',
  0x31: 'fuera de rango',
  0x33: 'acceso de seguridad denegado',
  0x7e: 'no disponible en la sesión actual',
  0x7f: 'no disponible en la sesión actual',
};

export function nrcReason(code: number): string {
  return NRC_REASONS[code] ?? `código de rechazo 0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
}
