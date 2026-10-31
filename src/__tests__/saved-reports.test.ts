import { MAX_SAVED_REPORTS, SavedReports, type SavedReport } from '@/domain/report/saved-reports';

const memory = () => {
  let saved: SavedReport[] = [];
  return { load: () => saved, save: (r: readonly SavedReport[]) => void (saved = [...r]) };
};
const report = (at: number): SavedReport => ({ id: `r${at}`, at, uri: `file:///r${at}.pdf`, vin: null, make: 'ford', codes: ['P2122'], workshop: null });

describe('Informes guardados', () => {
  it('keeps the newest ten and hands back the ones that fell out', () => {
    const log = new SavedReports(memory());
    for (let i = 1; i <= MAX_SAVED_REPORTS; i++) expect(log.add(report(i))).toEqual([]);
    expect(log.add(report(11))).toEqual([report(1)]);
    expect(log.list().map((r) => r.at)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it('removes one and says which', () => {
    const log = new SavedReports(memory());
    log.add(report(1));
    expect(log.remove('r1')?.uri).toBe('file:///r1.pdf');
    expect(log.list()).toEqual([]);
  });
});
