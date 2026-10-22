import { customerRemarkResult } from '../src/features/customers/guest';

describe('inline remark acknowledgement ownership and ordering', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let state: any;
  let input: any;
  const owner = '8613800000001@c.us';
  beforeEach(() => {
    input = { value: 'latest', dataset: { chatId: '10002@lid' }, title: '' };
    state = {
      data: { owner, aliases: { '10002@lid': '10002@c.us' } },
      inlineDrafts: new Map([[`${owner}:10002@c.us`, { value: 'latest' }]]),
    };
    for (const [key, value] of Object.entries({
      window: { __zlCustomers: state },
      document: { querySelectorAll: () => [input] },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('acknowledges an aliased contact after the latest inline value is persisted', () => {
    customerRemarkResult(owner, '10002@c.us', 'latest');
    expect(state.inlineDrafts.size).toBe(0);
    expect(input.dataset.saveState).toBe('saved');
  });
  it('never drops a newer draft when an older save completes late', () => {
    customerRemarkResult(owner, '10002@c.us', 'older');
    expect(state.inlineDrafts.size).toBe(1);
    expect(input.dataset.saveState).toBeUndefined();
  });
  it('retains a failed value with visible retry feedback', () => {
    customerRemarkResult(owner, '10002@c.us', 'latest', 'disk error');
    expect(state.inlineDrafts.get(`${owner}:10002@c.us`)).toEqual({
      value: 'latest',
      error: 'disk error',
    });
    expect(input.dataset.saveState).toBe('error');
    expect(input.title).toContain('disk error');
  });
  it('does not apply a save acknowledgement to a different logged-in account', () => {
    customerRemarkResult('8613800000002@c.us', '10002@c.us', 'latest');
    expect(state.inlineDrafts.size).toBe(1);
    expect(input.title).toBe('');
  });
});
