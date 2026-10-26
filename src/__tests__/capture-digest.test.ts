import { captureDigest, parseCapture } from '@/domain/obd/capture-digest';

// The capture the driver pasted on 2026-10-21 (VIN serial already hidden by the app).
const CAPTURE = `OBDient2 · OBDient

Captura de diagnóstico · 2026-10-21T21:27:27.469Z
Adaptador: ELM327 v2.2
Protocolo: ISO_15765_4_CAN_29BIT_500K

== Sin encabezados (ATH0) ==
> ATH0 (31 ms)
  OK
> 0101 (60 ms)
  41010007E121
  = ECU ?: 41 01 00 07 E1 21
> 0131 (59 ms)
  4131002F
  = ECU ?: 41 31 00 2F
> 03 (68 ms)
  4300
  = ECU ?: 43 00
> 0200 (242 ms · sin dato)
  NO DATA
> 020000 (59 ms)
  4200007E1F9803
  = ECU ?: 42 00 00 7E 1F 98 03
> 020200 (59 ms)
  4202000000
  = ECU ?: 42 02 00 00 00
> 0902 (77 ms)
  014
  0:490201384147
  = ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 ** ** ** ** ** **
> ATDP (36 ms)
  AUTO, ISO 15765-4 (CAN 29/500)

== Con encabezados (ATH1) ==
> 0131 (61 ms)
  18DAF111044131002F
  = 18DAF111: 41 31 00 2F
> 07 (73 ms)
  18DAF111024700
  = 18DAF111: 47 00
> 0A (72 ms)
  18DAF111024A00
  = 18DAF111: 4A 00

== ELM327: genuino o clon ==
> ATI (45 ms)
  ELM327 v2.2`;

describe('captureDigest', () => {
  it('says what each answer means, so the model does not decode hex by hand', () => {
    const d = captureDigest(CAPTURE)!;
    // The two the model got wrong on 2026-10-21.
    expect(d).toContain('0131 (distancia desde el último borrado de códigos): 47 km');
    expect(d).toContain('020000 (freeze frame, PIDs guardados):');
    expect(d).toContain('020200 (freeze frame, código que lo guardó): ninguno guardado');
    expect(d).toMatch(/0101 \(estado de monitores\): luz de falla apagada, 0 código\(s\) confirmados; monitores incompletos: /);
    expect(d).toContain('03 (códigos guardados): ninguno');
    expect(d).toContain('07 (códigos pendientes): ninguno');
    expect(d).toContain('0A (códigos permanentes): ninguno');
    expect(d).toContain('0200: sin respuesta');
    expect(d).toContain('0902 (VIN): presente');
    expect(d).toContain('ATDP: AUTO, ISO 15765-4 (CAN 29/500)');
    expect(d).toContain('ATI: ELM327 v2.2');
    expect(d).toContain('ECU que respondieron: 18DAF111');
    expect(d).not.toMatch(/ATH0/);
  });

  it('is much shorter than the capture', () => {
    expect(captureDigest(CAPTURE)!.length).toBeLessThan(CAPTURE.length);
  });

  it('keeps the driver’s own words ahead of the capture', () => {
    const d = captureDigest(`Mirá esta captura del Tracker\n\n${CAPTURE}`)!;
    expect(d.startsWith('Mirá esta captura del Tracker\n[Captura de diagnóstico decodificada')).toBe(true);
  });

  it('a request the app does not decode goes as bytes; a text that is not a capture is left alone', () => {
    const d = captureDigest('Captura de diagnóstico · x\n> 22F190 (10 ms)\n  = 18DAF111: 62 F1 90 01 02')!;
    expect(d).toContain('22F190: 18DAF111 62 F1 90 01 02 (sin decodificar)');
    expect(captureDigest('¿Qué es el 0131?')).toBeNull();
  });

  it('prefers the round with headers (it knows the ECU)', () => {
    const c = parseCapture(CAPTURE)!;
    expect(c.entries.find((e) => e.command === '0131')!.messages[0]!.ecu).toBe('18DAF111');
  });
});
