/**
 * Regresión: el path de la cookie de refresh debe coincidir con la ruta
 * real montada en app.js (app.use('/api/v1', v1)) — si diverge, el
 * navegador nunca adjunta la cookie al POST /api/v1/auth/refresh real y
 * el refresh silencioso falla siempre por falta de cookie, cerrando la
 * sesión de cualquier usuario a los 15 minutos (vida del access token)
 * sin importar cuánto haya usado la plataforma.
 */
import { describe, it, expect } from 'vitest';
import {
  authCookieOptions,
  clearCookieOptions,
  refreshCookieOptions,
  clearRefreshCookieOptions,
} from '../src/utils/cookieOptions.js';

const REAL_REFRESH_ROUTE = '/api/v1/auth/refresh';

describe('cookieOptions', () => {
  it('refreshCookieOptions() usa el path real de la ruta de refresh montada', () => {
    expect(refreshCookieOptions().path).toBe(REAL_REFRESH_ROUTE);
  });

  it('clearRefreshCookieOptions() usa el mismo path que refreshCookieOptions() — si difieren, la cookie no se borra en logout', () => {
    expect(clearRefreshCookieOptions().path).toBe(refreshCookieOptions().path);
  });

  it('refreshCookieOptions() sigue siendo httpOnly/secure/sameSite=None y respeta los días pedidos', () => {
    const opts = refreshCookieOptions(7);
    expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'None' });
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('authCookieOptions() y clearCookieOptions() siguen scoped a "/" (cookie de sesión, no de refresh)', () => {
    expect(authCookieOptions().path).toBe('/');
    expect(clearCookieOptions().path).toBe('/');
  });
});
