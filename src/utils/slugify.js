import slugifyLib from 'slugify';

/**
 * Genera un slug limpio en español (maneja tildes y ñ).
 */
export function slugify(text) {
  return slugifyLib(text, {
    lower: true,
    strict: true,
    locale: 'es',
  });
}
