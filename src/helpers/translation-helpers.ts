import translateGoogle from 'google-translate-api-x';
import { LIVE_API_FERDIUM_LIBRETRANSLATE } from '../config';

export async function translateTo(
  text: string,
  translateToLanguage: string,
  translatorEngine: string,
  source = 'auto',
): Promise<{ text: string; error: boolean }> {
  const errorText =
    // TODO: Need to support i18n
    'FERDIUM ERROR: An error occurred. Please select less text to translate or try again later.';

  if (translatorEngine === 'Google') {
    const translationResult = await translateGoogle(text, {
      to: translateToLanguage,
      from: source,
      requestOptions: { signal: AbortSignal.timeout(12_000) },
      autoCorrect: true,
      forceBatch: false,
      fallbackBatch: false,
    })
      .then(res => ({ text: res.text, error: false }))
      .catch(() => ({ text: errorText, error: true }));

    return translationResult;
  }

  if (translatorEngine === 'LibreTranslate') {
    try {
      const res = await fetch(LIVE_API_FERDIUM_LIBRETRANSLATE, {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          q: text,
          source,
          target: translateToLanguage,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) throw new Error('Translation unavailable');
      const response = await res.json();
      if (typeof response.translatedText !== 'string')
        throw new Error('Invalid translation');

      return { text: response.translatedText, error: false };
    } catch {
      return { text: errorText, error: true };
    }
  }

  return { text: errorText, error: true };
}
