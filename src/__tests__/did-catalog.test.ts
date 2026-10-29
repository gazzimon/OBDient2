import { OnlineTools } from '@/data/tools/online-tools';
import { ToolsClient, type ToolsFetch } from '@/data/tools/tools-client';
import { candidatePlan, didCatalogEntry, UDS_IDENTIFICATION_CATALOG, type DidCandidate } from '@/domain/obd/did-catalog';

const cand = (did: string, sample: DidCandidate['sample']): DidCandidate => ({ did, sample, source: 'inv' });

describe('DID catalog: how far each DID is known', () => {
  it('the identification DIDs are standard assignments, not checked on a car', () => {
    expect(UDS_IDENTIFICATION_CATALOG.every((e) => e.evidence === 'standard')).toBe(true);
    expect(didCatalogEntry(' f190 ')).toMatchObject({ did: 'F190', privacy: 'vehicle_identifier' });
  });
});

describe('candidatePlan', () => {
  it('most promising first, each DID once, standard ones left to "control"', () => {
    const plan = candidatePlan([cand('1172', 'negative'), cand('f10a', 'weak'), cand('0123', 'positive'), cand('0123', 'mixed'), cand('F190', 'positive'), cand('16C1', 'mixed'), cand('xx', 'positive')]);
    expect('dids' in plan && plan.dids).toEqual(['0123', '16C1', 'F10A', '1172']);
    expect('byDid' in plan && plan.byDid.get('0123')).toEqual(cand('0123', 'positive'));
  });

  it('goes on from a cursor, and says when there is nothing or the cursor is unknown', () => {
    const list = [cand('0123', 'positive'), cand('16C1', 'mixed'), cand('1172', 'negative')];
    expect(candidatePlan(list, '16c1')).toMatchObject({ dids: ['16C1', '1172'] });
    expect(candidatePlan(list, 'ABCD')).toMatchObject({ error: expect.stringContaining('cursor') });
    expect(candidatePlan([cand('F187', 'positive')])).toMatchObject({ error: expect.stringContaining('no tiene DIDs candidatos') });
  });
});

describe('the lab’s candidates in the app', () => {
  const CREDS = { baseUrl: 'https://x/llm/v1', apiKey: 'sk-test', model: 'm' };
  const signal = new AbortController().signal;
  const online = (fetchFn: ToolsFetch) => new OnlineTools(new ToolsClient({ url: 'https://obdient.duckdns.org/tools/', credentials: () => CREDS, fetchFn }));

  it('asks for the make’s list and keeps only well-formed entries', async () => {
    const bodies: string[] = [];
    const out = await online(async (_url, init) => {
      bodies.push(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ didCandidates: [{ did: '1172', sample: 'positive', src: 'inv', answeredBy: ['7E0'] }, { did: 'zz', sample: 'positive' }, { did: '16C1', sample: 'invented' }, { did: 'f10a', sample: 'weak' }] }),
      };
    }).didCandidates('ford', signal);
    expect(JSON.parse(bodies[0]!)).toEqual({ action: 'lookup', make: 'ford', candidates: true });
    expect(out).toEqual([cand('1172', 'positive'), { did: 'F10A', sample: 'weak', source: 'laboratorio' }]);
  });

  it('an unreachable lab is null, not an empty list', async () => {
    expect(await online(async () => ({ ok: false, status: 503, json: async () => ({}) })).didCandidates('ford', signal)).toBeNull();
  });
});
