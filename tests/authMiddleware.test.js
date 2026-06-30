import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../src/utils/tokenBlacklist.js', () => ({
  isRevoked:     vi.fn().mockReturnValue(false),
  revokeToken:   vi.fn(),
  loadBlacklist: vi.fn(),
}));

import { isRevoked } from '../src/utils/tokenBlacklist.js';
import { authenticate, optionalAuthenticate, authorize, requireSuperAdmin } from '../src/middlewares/auth.js';

const VALID_TOKEN = jwt.sign({ id: 'u1', rol: 'investigador', scope: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN_TOKEN = jwt.sign({ id: 'admin1', rol: 'admin_sig' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const SUPER_TOKEN  = jwt.sign({ id: 'super1', rol: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const SCOPE_2FA    = jwt.sign({ id: 'u1', scope: '2fa' }, process.env.JWT_SECRET, { expiresIn: '1h' });

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('authenticate middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', () => {
    const next = vi.fn();
    const r = res();
    authenticate({ cookies: {}, headers: {} }, r, next);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 con token revocado', () => {
    isRevoked.mockReturnValueOnce(true);
    const next = vi.fn();
    const r = res();
    authenticate({ cookies: { vigiiap_token: VALID_TOKEN }, headers: {} }, r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 con token de scope 2fa en ruta normal', () => {
    const next = vi.fn();
    const r = res();
    authenticate({ cookies: { vigiiap_token: SCOPE_2FA }, headers: {} }, r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 con token inválido', () => {
    const next = vi.fn();
    const r = res();
    authenticate({ cookies: { vigiiap_token: 'bad.token' }, headers: {} }, r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('pasa con token válido en cookie', () => {
    const next = vi.fn();
    const req = { cookies: { vigiiap_token: VALID_TOKEN }, headers: {} };
    authenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
  });

  it('pasa con token válido en header Authorization Bearer', () => {
    const next = vi.fn();
    const req = { cookies: {}, headers: { authorization: `Bearer ${VALID_TOKEN}` } };
    authenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('optionalAuthenticate middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pasa sin token (req.user undefined)', () => {
    const next = vi.fn();
    const req = { cookies: {}, headers: {} };
    optionalAuthenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('pasa con token válido y carga req.user', () => {
    const next = vi.fn();
    const req = { cookies: { vigiiap_token: VALID_TOKEN }, headers: {} };
    optionalAuthenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('u1');
  });

  it('pasa con token inválido y continúa como anónimo', () => {
    const next = vi.fn();
    const req = { cookies: { vigiiap_token: 'bad.token' }, headers: {} };
    optionalAuthenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});

describe('authorize middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pasa si el rol del usuario está permitido', () => {
    const next = vi.fn();
    const req = { user: { rol: 'investigador' } };
    authorize('investigador', 'admin_sig')(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('retorna 403 si el rol no está permitido', () => {
    const next = vi.fn();
    const r = res();
    authorize('admin_sig')({ user: { rol: 'publico' } }, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('super_admin siempre pasa independientemente del rol requerido', () => {
    const next = vi.fn();
    authorize('admin_sig')({ user: { rol: 'super_admin' } }, res(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireSuperAdmin middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pasa si el rol es super_admin', () => {
    const next = vi.fn();
    requireSuperAdmin({ user: { rol: 'super_admin' } }, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('retorna 403 si no es super_admin', () => {
    const next = vi.fn();
    const r = res();
    requireSuperAdmin({ user: { rol: 'admin_sig' } }, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});

describe('optionalAuthenticate — token revocado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('continúa como anónimo si el token está revocado', () => {
    isRevoked.mockReturnValueOnce(true);
    const next = vi.fn();
    const req = { cookies: { vigiiap_token: VALID_TOKEN }, headers: {} };
    optionalAuthenticate(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
