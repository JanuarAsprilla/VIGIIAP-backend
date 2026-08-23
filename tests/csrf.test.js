/**
 * Protección CSRF (double-submit vía HMAC) — src/utils/csrf.js y
 * src/middlewares/csrf.js.
 *
 * Contexto: las cookies de sesión usan sameSite: 'None' (frontend y backend
 * en subdominios distintos), así que el navegador SÍ adjunta la cookie en
 * peticiones cross-site. express.urlencoded está deshabilitado, pero multer
 * sigue parseando multipart/form-data (subida de archivos) sin preflight
 * CORS — ese es el vector real. Estos tests verifican que el middleware
 * bloquea peticiones mutantes autenticadas por cookie sin el token CSRF
 * correcto, y que no interfiere con clientes Bearer (no vulnerables a CSRF).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCsrfToken, verifyCsrfToken, CSRF_HEADER } from '../src/utils/csrf.js';
import { csrfProtection } from '../src/middlewares/csrf.js';

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('utils/csrf', () => {
  const token = 'access-token-abc123';

  it('generateCsrfToken() es determinista para el mismo access token', () => {
    expect(generateCsrfToken(token)).toBe(generateCsrfToken(token));
  });

  it('generateCsrfToken() produce valores distintos para access tokens distintos', () => {
    expect(generateCsrfToken(token)).not.toBe(generateCsrfToken('otro-token'));
  });

  it('verifyCsrfToken() acepta el token correcto', () => {
    const csrf = generateCsrfToken(token);
    expect(verifyCsrfToken(token, csrf)).toBe(true);
  });

  it('verifyCsrfToken() rechaza un token CSRF incorrecto', () => {
    expect(verifyCsrfToken(token, 'deadbeef'.repeat(8))).toBe(false);
  });

  it('verifyCsrfToken() rechaza un token CSRF de otra sesión', () => {
    const csrfDeOtraSesion = generateCsrfToken('otro-token');
    expect(verifyCsrfToken(token, csrfDeOtraSesion)).toBe(false);
  });

  it('verifyCsrfToken() rechaza si falta el header', () => {
    expect(verifyCsrfToken(token, undefined)).toBe(false);
  });

  it('verifyCsrfToken() rechaza si falta el access token', () => {
    expect(verifyCsrfToken(undefined, generateCsrfToken(token))).toBe(false);
  });

  it('verifyCsrfToken() no lanza con un header no-hex o de longitud arbitraria', () => {
    expect(verifyCsrfToken(token, 'no-soy-hex-válido')).toBe(false);
    expect(verifyCsrfToken(token, '')).toBe(false);
  });
});

describe('middlewares/csrf — csrfProtection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deja pasar peticiones GET sin exigir token CSRF (método seguro)', () => {
    const next = vi.fn();
    const req = { method: 'GET', cookies: { vigiiap_token: 'tok' }, headers: {} };
    csrfProtection(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('deja pasar peticiones mutantes sin cookie de sesión (cliente Bearer, no vulnerable a CSRF)', () => {
    const next = vi.fn();
    const req = { method: 'POST', cookies: {}, headers: { authorization: 'Bearer tok' } };
    csrfProtection(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rechaza con 403 una petición mutante con cookie de sesión y sin header X-CSRF-Token', () => {
    const next = vi.fn();
    const r = res();
    const req = { method: 'POST', cookies: { vigiiap_token: 'tok' }, headers: {} };
    csrfProtection(req, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rechaza con 403 una petición mutante con cookie de sesión y header X-CSRF-Token incorrecto', () => {
    const next = vi.fn();
    const r = res();
    const req = {
      method: 'DELETE',
      cookies: { vigiiap_token: 'tok' },
      headers: { [CSRF_HEADER]: 'valor-forjado-por-el-atacante' },
    };
    csrfProtection(req, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deja pasar una petición mutante con cookie de sesión y el token CSRF correcto', () => {
    const next = vi.fn();
    const cookieToken = 'tok';
    const req = {
      method: 'PATCH',
      cookies: { vigiiap_token: cookieToken },
      headers: { [CSRF_HEADER]: generateCsrfToken(cookieToken) },
    };
    csrfProtection(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rechaza si el token CSRF fue generado para una cookie distinta a la de la petición', () => {
    const next = vi.fn();
    const r = res();
    const req = {
      method: 'PUT',
      cookies: { vigiiap_token: 'tok-actual' },
      headers: { [CSRF_HEADER]: generateCsrfToken('tok-de-otra-sesion') },
    };
    csrfProtection(req, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});
