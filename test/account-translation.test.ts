/* eslint-disable jest/no-conditional-expect -- Each protocol/provider branch checks its distinct wire format. */
import { translateAccount } from '../src/electron/accountTranslation';

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
it.each([
  [
    'Google',
    [[['你好', 'hello']]],
    'https://translate.googleapis.com/translate_a/single',
  ],
  [
    'DeepL',
    { translations: [{ text: '你好' }] },
    'https://api-free.deepl.com/v2/translate',
  ],
  [
    'OpenAI',
    { output: [{ content: [{ type: 'output_text', text: '你好' }] }] },
    'https://api.openai.com/v1/responses',
  ],
  [
    'Gemini',
    { candidates: [{ content: { parts: [{ text: '你好' }] } }] },
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  ],
] as const)(
  'translates with %s through the injected account transport',
  async (engine, data, url) => {
    const transport = jest.fn(async () => response(data));
    expect(
      await translateAccount(
        transport,
        'hello',
        'zh-CN',
        engine,
        'auto',
        'synthetic-key',
      ),
    ).toEqual({ text: '你好', error: false });
    expect(transport).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'POST' }),
    );
    const init = (transport.mock.calls[0] as any)[1];
    if (engine === 'DeepL') {
      expect(init.headers.Authorization).toBe('DeepL-Auth-Key synthetic-key');
      expect(JSON.parse(init.body)).toEqual({
        text: ['hello'],
        target_lang: 'ZH',
      });
    }
    if (engine === 'OpenAI')
      expect(init.headers.Authorization).toBe('Bearer synthetic-key');
    if (engine === 'Gemini')
      expect(init.headers['x-goog-api-key']).toBe('synthetic-key');
  },
);
it('does not make a request without a required key and never echoes provider secrets/errors', async () => {
  const transport = jest.fn(async () =>
    response({ error: 'synthetic-secret' }, 401),
  );
  expect(
    await translateAccount(transport, 'hello', 'en', 'DeepL', 'auto'),
  ).toMatchObject({ error: true, message: expect.stringContaining('API Key') });
  expect(transport).not.toHaveBeenCalled();
  const result = await translateAccount(
    transport,
    'hello',
    'en',
    'DeepL',
    'auto',
    'synthetic-secret',
  );
  expect(result.message).toContain('401');
  expect(JSON.stringify(result)).not.toContain('synthetic-secret');
});
it('fails closed on unavailable or malformed providers', async () => {
  expect(
    await translateAccount(
      async () => {
        throw new Error('url with secret');
      },
      'hello',
      'en',
      'Google',
      'auto',
    ),
  ).toMatchObject({ error: true, text: '' });
  expect(
    await translateAccount(
      async () => response({}),
      'hello',
      'en',
      'Google',
      'auto',
    ),
  ).toMatchObject({ error: true, text: '' });
});
