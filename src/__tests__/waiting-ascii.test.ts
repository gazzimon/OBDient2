import { FILAS, VARIANTES } from '@/domain/assistant/waiting-ascii';

describe('waiting animations', () => {
  it.each(VARIANTES.map((v) => [v.id, v] as const))('%s keeps the grid: 9 rows of exactly `cols` characters', (_id, v) => {
    for (const cols of [24, 41]) {
      for (const cuadro of [0, 1, 37, 500]) {
        const rows = v.dibujar(cuadro, cols, FILAS).split('\n');
        expect(rows).toHaveLength(FILAS);
        for (const r of rows) expect([...r]).toHaveLength(cols);
      }
    }
  });

  it('moves from one frame to the next', () => {
    for (const v of VARIANTES) expect([v.id, v.dibujar(0, 30, FILAS) === v.dibujar(7, 30, FILAS)]).toEqual([v.id, false]);
  });
});
