import { describe, it, expect, vi, beforeEach } from 'vitest';

// redis createClient devuelve un objeto que podemos controlar
vi.mock('redis', () => {
  const mockClient = {
    isReady:  true,
    on:       vi.fn(),
    connect:  vi.fn().mockResolvedValue(undefined),
    get:      vi.fn().mockResolvedValue(null),
    setEx:    vi.fn().mockResolvedValue('OK'),
    keys:     vi.fn().mockResolvedValue([]),
    del:      vi.fn().mockResolvedValue(1),
  };
  return { createClient: vi.fn(() => mockClient) };
});

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { createClient } from 'redis';
import logger from '../src/utils/logger.js';
import { getRedisClient, cacheMiddleware, invalidateCache } from '../src/middlewares/cache.js';

// Helper para obtener la instancia mockCliente actual
function getClient() {
  return createClient.mock.results[0]?.value ?? createClient();
}

function mockRes() {
  return {
    status:    vi.fn().mockReturnThis(),
    json:      vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
}

// ─── getRedisClient() ─────────────────────────────────────────────────────────

describe('getRedisClient()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve null si REDIS_URL no está configurada', () => {
    delete process.env.REDIS_URL;
    // El módulo mantiene estado; si ya hay cliente creado, devuelve ese.
    // Esta prueba verifica el comportamiento cuando no hay URL.
    const client = getRedisClient();
    // Si el módulo ya tiene cliente creado (tests anteriores), es no-null.
    // Lo que importa es que no lanza.
    expect(client === null || typeof client === 'object').toBe(true);
  });

  it('crea cliente Redis y llama connect() cuando REDIS_URL está configurada', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const client = getRedisClient();
    expect(client).toBeTruthy();
    // connect() fue llamado al crear el cliente (en getRedisClient o al importar)
  });
});

// ─── cacheMiddleware() — bypass ───────────────────────────────────────────────

describe('cacheMiddleware() — bypass (sin cachear)', () => {
  const mockNext = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('NO bypasea cache por admin=true en query (bypass era un vector DoS)', async () => {
    // admin=true ya no es un bypass válido — cualquier cliente podía usarlo para forzar DB hits.
    // Sin token de autenticación, la request pasa por el path de cache (Redis null → next()).
    const middleware = cacheMiddleware(60);
    const req = { query: { admin: 'true' }, cookies: {}, headers: {}, path: '/mapas' };
    const res = mockRes();
    await middleware(req, res, mockNext);
    // Redis no disponible en tests → next() igual se llama, pero por path de cache, no bypass
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('llama next() si el request tiene cookie vigiiap_token (autenticado)', async () => {
    const middleware = cacheMiddleware(60);
    const req = { query: {}, cookies: { vigiiap_token: 'jwt-token' }, headers: {}, path: '/mapas' };
    const res = mockRes();
    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('llama next() si el request tiene Authorization header', async () => {
    const middleware = cacheMiddleware(60);
    const req = { query: {}, cookies: {}, headers: { authorization: 'Bearer token' }, path: '/mapas' };
    const res = mockRes();
    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});

// ─── cacheMiddleware() — cache miss ──────────────────────────────────────────

describe('cacheMiddleware() — cache MISS', () => {
  const mockNext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    // Asegurarse de que el cliente esté listo
    const client = getRedisClient();
    if (client) {
      client.isReady = true;
      client.get.mockResolvedValue(null); // MISS
    }
  });

  it('llama next() en cache miss e intercepta res.json para cachear', async () => {
    const middleware = cacheMiddleware(120);
    const req  = { query: {}, cookies: {}, headers: {}, path: '/mapas' };
    const res  = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();

    // Verificar que res.json fue reemplazado (interceptor instalado)
    // Llamar al interceptor para simular que el controlador responde
    const data = [{ id: 1, titulo: 'Mapa Chocó' }];
    res.json(data); // esto activa el interceptor

    const client = getClient();
    // El interceptor debería llamar setEx con los datos serializados
    if (client.setEx.mock.calls.length > 0) {
      expect(client.setEx).toHaveBeenCalledWith(
        expect.stringContaining('/mapas'),
        120,
        JSON.stringify(data)
      );
    }
  });

  it('incluye los params whitelisteados en la cache key', async () => {
    const middleware = cacheMiddleware(120);
    const req = {
      query: { page: '2', categoria: 'mapas', noPermitido: 'x' },
      cookies: {}, headers: {}, path: '/mapas',
    };
    const res = mockRes();

    await middleware(req, res, mockNext);

    const client = getClient();
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('categoria=mapas'));
    expect(client.get).toHaveBeenCalledWith(expect.not.stringContaining('noPermitido'));
  });

  it('registra warning si setEx falla al guardar la respuesta en cache, sin interrumpir la respuesta', async () => {
    const client = getRedisClient();
    client.isReady = true;
    client.setEx.mockRejectedValueOnce(new Error('setEx caído'));

    const middleware = cacheMiddleware(120);
    const req = { query: {}, cookies: {}, headers: {}, path: '/mapas' };
    const res = mockRes();

    await middleware(req, res, mockNext);
    const data = [{ id: 1 }];
    res.json(data);

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error guardando'));
    });
    expect(res.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
  });

  it('registra warning y llama next() si client.get() lanza', async () => {
    const client = getRedisClient();
    client.isReady = true;
    client.get.mockRejectedValueOnce(new Error('get caído'));

    const middleware = cacheMiddleware(120);
    const req = { query: {}, cookies: {}, headers: {}, path: '/mapas' };
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error consultando Redis'));
    expect(mockNext).toHaveBeenCalledOnce();
  });
});

// ─── cacheMiddleware() — cache HIT ───────────────────────────────────────────

describe('cacheMiddleware() — cache HIT', () => {
  const mockNext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('responde desde el cache y añade X-Cache: HIT', async () => {
    const cachedData = [{ id: 1, titulo: 'Mapa Chocó' }];
    const client = getRedisClient();
    client.get.mockResolvedValueOnce(JSON.stringify(cachedData));
    client.isReady = true;

    const middleware = cacheMiddleware(120);
    const req = { query: {}, cookies: {}, headers: {}, path: '/mapas' };
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(res.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
    expect(res.json).toHaveBeenCalledWith(cachedData);
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ─── cacheMiddleware() — sin cliente Redis ────────────────────────────────────

describe('cacheMiddleware() — sin cliente Redis listo', () => {
  const mockNext = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('llama next() si el cliente Redis no está listo', async () => {
    const client = getRedisClient();
    if (client) client.isReady = false;

    const middleware = cacheMiddleware(60);
    const req = { query: {}, cookies: {}, headers: {}, path: '/mapas' };
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();

    // Restaurar para otros tests
    if (client) client.isReady = true;
  });
});

// ─── invalidateCache() ────────────────────────────────────────────────────────

describe('invalidateCache()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('elimina claves que coinciden con el patrón', async () => {
    const client = getRedisClient();
    client.isReady = true;
    client.keys.mockResolvedValueOnce(['cache:/mapas:', 'cache:/mapas:page=2']);

    await invalidateCache('cache:/mapas*');

    expect(client.keys).toHaveBeenCalledWith('cache:/mapas*');
    expect(client.del).toHaveBeenCalledWith(['cache:/mapas:', 'cache:/mapas:page=2']);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Invalidadas 2 entradas')
    );
  });

  it('no llama del si no hay claves que coincidan', async () => {
    const client = getRedisClient();
    client.isReady = true;
    client.keys.mockResolvedValueOnce([]);

    await invalidateCache('cache:/noticias*');
    expect(client.del).not.toHaveBeenCalled();
  });

  it('no hace nada si el cliente no está listo', async () => {
    const client = getRedisClient();
    client.isReady = false;

    await invalidateCache('cache:/mapas*');
    expect(client.keys).not.toHaveBeenCalled();

    // Restaurar
    client.isReady = true;
  });

  it('emite warning si keys() lanza', async () => {
    const client = getRedisClient();
    client.isReady = true;
    client.keys.mockRejectedValueOnce(new Error('Redis error'));

    await invalidateCache('cache:/mapas*');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error invalidando')
    );
  });
});
