import { buildReportHtml, esc, type ReportData } from '@/domain/report/diagnostic-report';

const BASE: ReportData = {
  generatedAt: new Date(2026, 9, 28, 14, 5).getTime(),
  vin: '8AGEA76C0RR123456',
  make: 'Chevrolet',
  workshop: null,
  adapter: 'STN1040',
  storedCodes: [{ code: 'P0171', description: 'Sistema demasiado pobre (banco 1).' }],
  pendingCodes: [],
  readiness: { milOn: true, complete: ['catalizador'], incomplete: ['evaporativo (EVAP)'], distSinceClearKm: 1420 },
  live: [{ label: 'Temperatura del motor', value: '90 °C' }],
  hypotheses: [
    {
      title: 'Entrada de aire falso',
      system: 'admisión',
      confidence: 82,
      evidence: ['código de mezcla pobre'],
      checks: ['Revisar mangueras de vacío'],
      safety: null,
    },
  ],
  unusual: ['ralentí en caliente: 1050 rpm (lo habitual es 800)'],
  baseline: [{ label: 'ralentí en caliente', text: '800 rpm (entre 780 y 820, 6 mediciones)' }],
  history: [{ at: new Date(2026, 9, 20).getTime(), text: 'Apareció P0171' }],
  service: [{ at: new Date(2026, 8, 1).getTime(), item: 'Cambio de aceite', km: 81250 }],
  notes: null,
};

describe('buildReportHtml', () => {
  it('has every section with what was read', () => {
    const html = buildReportHtml(BASE);
    for (const text of ['Informe de diagnóstico', 'Códigos de falla', 'P0171', 'encendido', '1.420 km', 'Causas más probables', 'Coincidencia 82%', 'Lo habitual en este auto', '81.250 km', '28/10/2026 14:05']) {
      expect(html).toContain(text);
    }
  });

  it('hides the VIN serial and never shows it whole', () => {
    const html = buildReportHtml(BASE);
    expect(html).toContain('8AGEA76C0RR');
    expect(html).not.toContain('123456');
  });

  it('tells "could not read" from "none", and leaves empty sections out', () => {
    const html = buildReportHtml({ ...BASE, storedCodes: null, pendingCodes: [], readiness: null, hypotheses: [], unusual: [], baseline: [], history: [], service: [], live: [] });
    expect(html).toContain('Guardados:</b> <span class="muted">no se pudieron leer.');
    expect(html).toContain('Pendientes:</b> ninguno.');
    expect(html).not.toContain('Causas más probables');
    expect(html).not.toContain('Antecedentes');
  });

  it('escapes everything that comes from the car or the user', () => {
    const html = buildReportHtml({ ...BASE, notes: '<script>alert(1)</script>\nsegunda línea', workshop: 'Taller "El Rayo" & Hijos' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>segunda línea');
    expect(html).toContain('Taller &quot;El Rayo&quot; &amp; Hijos');
    expect(esc(`'`)).toBe('&#39;');
  });

  it('a safety warning stands out', () => {
    const html = buildReportHtml({ ...BASE, hypotheses: [{ ...BASE.hypotheses[0]!, safety: 'No sigas andando.' }] });
    expect(html).toContain('<div class="warn">⚠ No sigas andando.</div>');
  });
});
