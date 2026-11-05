import { describe, it, expect } from 'vitest';
import { redactarUrl } from '../src/utils/redactarUrl.js';

const TOKEN = 'a'.repeat(64);

describe('redactarUrl', () => {
  it('oculta los tokens de restablecimiento y verificación en la ruta', () => {
    expect(redactarUrl(`/api/v1/auth/verificar-email/${TOKEN}`)).toBe('/api/v1/auth/verificar-email/[REDACTED]');
    expect(redactarUrl(`/reset-password/${TOKEN}`)).toBe('/reset-password/[REDACTED]');
  });

  it('oculta code y state del callback de OAuth sin tocar el resto de la consulta', () => {
    const url = '/api/v1/auth/oauth/google/callback?code=4%2F0AbCd&state=eyJhbGciOi.xyz&otro=1';
    expect(redactarUrl(url)).toBe('/api/v1/auth/oauth/google/callback?code=[REDACTED]&state=[REDACTED]&otro=1');
  });

  it('oculta tokens de acceso aunque no sean el primer parámetro', () => {
    expect(redactarUrl('/x?a=1&access_token=abc.def&id_token=ghi')).toBe('/x?a=1&access_token=[REDACTED]&id_token=[REDACTED]');
  });

  it('deja intactas las URLs sin credenciales y tolera valores vacíos', () => {
    expect(redactarUrl('/api/v1/mapas?page=2&q=atrato')).toBe('/api/v1/mapas?page=2&q=atrato');
    expect(redactarUrl('/api/v1/descargar/mapa/codigo')).toBe('/api/v1/descargar/mapa/codigo');
    expect(redactarUrl(undefined)).toBe('');
  });
});
