/* eslint-disable unicorn/prefer-dom-node-text-content -- The editor API preserves line breaks through innerText. */
import { translationResult } from '../src/features/accountTools/guest';

describe('two-phase native editor replacement guards', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let input: any;
  let state: any;
  let selection: any;
  beforeEach(() => {
    input = {
      isConnected: true,
      innerText: 'original draft',
      focus: jest.fn(),
      contains: jest.fn(() => true),
    };
    selection = {
      anchorNode: input,
      removeAllRanges: jest.fn(),
      addRange: jest.fn(),
    };
    state = {
      token: 'document-1',
      busy: true,
      pending: new Map([
        [
          1,
          {
            direction: 'outgoing',
            input,
            text: 'original draft',
            chat: 'chat-1',
          },
        ],
      ]),
      composer: () => input,
      chatKey: () => 'chat-1',
      normalizeText: (text: string) => text.replaceAll('\u00A0', ' ').trim(),
      notice: jest.fn(),
    };
    for (const [name, value] of Object.entries({
      location: { hostname: 'web.whatsapp.com' },
      window: { __zlTranslation: state },
      document: {
        createRange: () => ({ selectNodeContents: jest.fn() }),
        getSelection: () => selection,
      },
    })) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    originals.clear();
  });
  it('selects the intended draft without DOM mutation and approves only after native input completes', () => {
    const result = { text: 'translated text', error: false };
    expect(translationResult(1, 'document-1', result)).toBe(true);
    expect(input.innerText).toBe('original draft');
    expect(state.approved).toBeUndefined();
    expect(state.busy).toBe(true);
    input.innerText = 'translated\u00A0text';
    expect(translationResult(1, 'document-1', result, 'complete')).toBe(false);
    expect(state.approved).toEqual({ input, chat: 'chat-1' });
    expect(state.busy).toBe(false);
  });
  it('never edits a draft that changed while translation was pending', () => {
    input.innerText = 'new draft';
    expect(
      translationResult(1, 'document-1', { text: 'translation', error: false }),
    ).toBe(false);
    expect(input.focus).not.toHaveBeenCalled();
    expect(input.innerText).toBe('new draft');
    expect(state.approved).toBeUndefined();
  });
  it('does not act on a different document or chat', () => {
    expect(
      translationResult(1, 'different-document', {
        text: 'translation',
        error: false,
      }),
    ).toBe(false);
    state.chatKey = () => 'chat-2';
    expect(
      translationResult(1, 'document-1', { text: 'translation', error: false }),
    ).toBe(false);
    expect(input.focus).not.toHaveBeenCalled();
  });
  it('keeps the original unsent on provider failure and does not approve a failed insertion', () => {
    expect(
      translationResult(1, 'document-1', {
        text: '',
        error: true,
        message: 'provider unavailable',
      }),
    ).toBe(false);
    expect(input.innerText).toBe('original draft');
    expect(state.notice).toHaveBeenCalledWith(
      expect.stringContaining('provider unavailable'),
    );
    state.pending.set(2, {
      direction: 'outgoing',
      input,
      text: 'original draft',
      chat: 'chat-1',
    });
    translationResult(
      2,
      'document-1',
      { text: 'translation', error: false },
      'complete',
    );
    expect(state.approved).toBeUndefined();
  });
  it('retains a clickable retry on failed message preview and hides the button on success', () => {
    const record: any = {
      container: { isConnected: true, style: {} },
      button: { style: {} },
      label: {},
    };
    state.config = { incoming: true };
    state.incoming = new WeakMap([[input, record]]);
    const job = { direction: 'incoming', input, text: input.innerText, record };
    state.pending.set(3, job);
    translationResult(3, 'document-1', { text: '', error: true });
    expect(record.status).toBe('error');
    expect(record.button).toMatchObject({
      disabled: false,
      hidden: false,
      textContent: '点击翻译',
    });
    state.pending.set(4, job);
    translationResult(4, 'document-1', {
      text: 'translated bubble',
      error: false,
    });
    expect(record.label.textContent).toBe('translated bubble');
    expect(record.button.hidden).toBe(true);
    expect(input.innerText).toBe('original draft');
  });
});
