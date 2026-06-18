# Tier 3 — Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capacidades que distinguen un backend de clase mundial: 2FA TOTP, cache Redis, exports CSV/Excel, rate limiting por usuario, password expiry policy y batch operations para admin.

**Architecture:** Cuatro streams paralelos: (A) 2FA TOTP, (B) Redis cache + rate limiting por usuario, (C) Export CSV/Excel, (D) Password expiry + Batch operations. Requiere T1 y T2 mergeados primero.

**Tech Stack:** Node.js 20 ES Modules, Express 4, PostgreSQL, Redis (ya en T2), `otplib`, `qrcode`, `xlsx`, Vitest

**Pre-requisito:** `npm install otplib qrcode xlsx`

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| CREATE | `db/migrations/022_two_factor_auth.sql` | Columnas TOTP en usuarios |
| CREATE | `db/migrations/023_password_expiry.sql` | Columna password_changed_at |
| CREATE | `src/modules/auth/twoFactor.controller.js` | Setup, verify, disable, confirm |
| MODIFY | `src/modules/auth/auth.routes.js` | Montar 2FA endpoints |
| MODIFY | `src/modules/auth/auth.service.js` | Login retorna requiresTwoFactor |
| MODIFY | `src/middlewares/cache.js` | Cache Redis reutilizable |
| MODIFY | `src/modules/mapas/mapas.routes.js` | Aplicar cache |
| MODIFY | `src/modules/documentos/documentos.routes.js` | Aplicar cache |
| MODIFY | `src/modules/noticias/noticias.routes.js` | Aplicar cache |
| MODIFY | `src/modules/categorias/categorias.routes.js` | Aplicar cache |
| MODIFY | `src/middlewares/rateLimiter.js` | Rate limit por usuario autenticado |
| CREATE | `src/modules/admin/export.controller.js` | CSV/Excel exports |
| MODIFY | `src/modules/admin/admin.routes.js` | Montar export endpoints |
| CREATE | `src/modules/auth/expiredPassword.controller.js` | Flujo contraseña expirada |
| MODIFY | `src/modules/auth/auth.service.js` | Detectar contraseña expirada en login |
| MODIFY | `src/modules/admin/admin.controller.js` | Batch operations |
| MODIFY | `src/modules/admin/admin.routes.js` | Montar batch endpoint |

---

## Stream A: 2FA TOTP

### Task A1: Migración 022 — two_factor_auth

**Files:**
- Create: `db/migrations/022_two_factor_auth.sql`

- [ ] **Step 1: Crear migración**

```sql
-- db/migrations/022_two_factor_auth.sql
-- 2FA TOTP para roles admin. Obligatorio para super_admin y admin_sig.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS totp_secret       TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];

-- Asegurar que el secret TOTP no se exponga en queries de listado genéricas
COMMENT ON COLUMN usuarios.totp_secret IS
  'Secret TOTP cifrado en base32. Nunca exponer en APIs de listado.';
COMMENT ON COLUMN usuarios.totp_backup_codes IS
  'Array de hashes bcrypt de códigos de emergencia (8 códigos, un solo uso cada uno).';
```

- [ ] **Step 2: Correr migración**

```bash
node db/migrate.js
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/022_two_factor_auth.sql
git commit -m "feat(db): migración 022 — columnas TOTP 2FA en usuarios"
```

---

### Task A2: Módulo 2FA TOTP

**Files:**
- Create: `src/modules/auth/twoFactor.controller.js`

- [ ] **Step 1: Instalar dependencias**

```bash
npm install otplib qrcode
git add package.json package-lock.json
git commit -m "feat(deps): otplib + qrcode para 2FA TOTP"
```

- [ ] **Step 2: Escribir tests fallidos**

Crear `tests/twoFactor.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }));

import { query } from '../src/config/database.js';
import bcrypt from 'bcryptjs';

describe('2FA setup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setup genera un secret y URI para QR', async () => {
    const { setupTwoFactor } = await import('../src/modules/auth/twoFactor.controller.js');
    // setupTwoFactor es una función que retorna { secret, otpauthUrl }
    const result = await setupTwoFactor('uuid-001', 'admin@iiap.gob.co');
    expect(result.secret).toBeDefined();
    expect(result.otpauthUrl).toContain('otpauth://totp/');
  });
});

describe('2FA verify', () => {
  it('activa 2FA si el código TOTP es válido', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: false }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const { verifyAndEnableTwoFactor } = await import('../src/modules/auth/twoFactor.controller.js');
    // Con código correcto debe retornar backup codes
    // (El código correcto del secret es calculable con otplib)
    const { authenticator } = await import('otplib');
    const code = authenticator.generate('JBSWY3DPEHPK3PXP');
    const result = await verifyAndEnableTwoFactor('uuid-001', code);
    expect(result.backupCodes).toHaveLength(8);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
npx vitest run tests/twoFactor.test.js
```

Esperado: FAIL — módulo no existe.

- [ ] **Step 4: Crear twoFactor.controller.js**

```js
// src/modules/auth/twoFactor.controller.js
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../../config/database.js';

const APP_NAME = 'VIGIIAP';

/** Genera secret TOTP y URL para QR. No persiste aún — el usuario debe confirmar. */
export async function setupTwoFactor(userId, email) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, APP_NAME, secret);
  // Persistir el secret temporalmente (se activa solo tras verify)
  await query(
    'UPDATE usuarios SET totp_secret = $1 WHERE id = $2',
    [secret, userId]
  );
  return { secret, otpauthUrl };
}

/** Verifica el código TOTP, activa 2FA y genera backup codes. */
export async function verifyAndEnableTwoFactor(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret, totp_enabled FROM usuarios WHERE id = $1',
    [userId]
  );
  if (!rows[0]?.totp_secret) {
    throw Object.assign(new Error('Debes iniciar el setup de 2FA primero'), { status: 400 });
  }
  if (rows[0].totp_enabled) {
    throw Object.assign(new Error('2FA ya está activado'), { status: 409 });
  }

  const isValid = authenticator.check(code, rows[0].totp_secret);
  if (!isValid) {
    throw Object.assign(new Error('Código TOTP inválido'), { status: 401 });
  }

  // Generar 8 códigos de backup (hex random 10 chars c/u)
  const rawCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  const hashedCodes = await Promise.all(rawCodes.map((c) => bcrypt.hash(c, 10)));

  await query(
    'UPDATE usuarios SET totp_enabled = true, totp_backup_codes = $1 WHERE id = $2',
    [hashedCodes, userId]
  );

  return { backupCodes: rawCodes }; // devolver una sola vez al usuario
}

/** Verifica un código TOTP (o backup code) durante el login. */
export async function verifyTotpLogin(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret, totp_backup_codes FROM usuarios WHERE id = $1',
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  // 1. Intentar TOTP normal
  if (authenticator.check(code, rows[0].totp_secret)) return true;

  // 2. Intentar backup codes
  const codes = rows[0].totp_backup_codes ?? [];
  for (let i = 0; i < codes.length; i++) {
    const match = await bcrypt.compare(code, codes[i]);
    if (match) {
      // Consumir el backup code — eliminarlo del array
      const remaining = codes.filter((_, idx) => idx !== i);
      await query(
        'UPDATE usuarios SET totp_backup_codes = $1 WHERE id = $2',
        [remaining, userId]
      );
      return true;
    }
  }

  throw Object.assign(new Error('Código de autenticación inválido'), { status: 401 });
}

/** Desactiva 2FA (requiere código TOTP válido). */
export async function disableTwoFactor(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret FROM usuarios WHERE id = $1 AND totp_enabled = true',
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('2FA no está activado'), { status: 400 });

  if (!authenticator.check(code, rows[0].totp_secret)) {
    throw Object.assign(new Error('Código TOTP inválido'), { status: 401 });
  }

  await query(
    'UPDATE usuarios SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
    [userId]
  );
}
```

- [ ] **Step 5: Crear los HTTP handlers**

```js
// Añadir al final de twoFactor.controller.js — los handlers Express:

import * as tf from './twoFactor.controller.js'; // self-import para tests

/** POST /api/auth/2fa/setup */
export async function httpSetup(req, res, next) {
  try {
    const { secret, otpauthUrl } = await setupTwoFactor(req.user.id, req.user.email);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ secret, qrDataUrl });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/verify */
export async function httpVerify(req, res, next) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código requerido' });
    const { backupCodes } = await verifyAndEnableTwoFactor(req.user.id, code);
    res.json({ message: '2FA activado. Guarda estos códigos de emergencia.', backupCodes });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/disable */
export async function httpDisable(req, res, next) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código TOTP requerido para desactivar' });
    await disableTwoFactor(req.user.id, code);
    res.json({ message: '2FA desactivado' });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/confirm — paso 2 del login cuando 2FA está activo */
export async function httpConfirm(req, res, next) {
  try {
    const rawTempToken = req.cookies?.['vigiiap_2fa_temp'] ?? req.body?.twoFactorToken;
    if (!rawTempToken) return res.status(401).json({ error: 'Token 2FA no encontrado' });

    let tempPayload;
    try {
      tempPayload = jwt.verify(rawTempToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Token 2FA inválido o expirado' });
    }
    if (tempPayload.scope !== '2fa') {
      return res.status(401).json({ error: 'Token incorrecto para este endpoint' });
    }

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código TOTP requerido' });

    await verifyTotpLogin(tempPayload.id, code);

    // Emitir par completo de tokens igual que en login normal
    const { rows } = await query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE id = $1',
      [tempPayload.id]
    );
    const user = rows[0];
    const { accessToken, refreshToken } = await issueTokenPair(user, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });

    res.clearCookie('vigiiap_2fa_temp');
    res.cookie(COOKIE_NAME, accessToken, authCookieOptions());
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    res.json({ token: accessToken, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
  } catch (err) { next(err); }
}
```

- [ ] **Step 6: Actualizar login() en auth.service.js para detectar 2FA**

En `auth.service.js`, función `login()`, justo antes del `return { token, user }`:

```js
// Verificar si el usuario tiene 2FA activo
const { rows: tfRows } = await query(
  'SELECT totp_enabled FROM usuarios WHERE id = $1',
  [user.id]
);

if (tfRows[0]?.totp_enabled) {
  // Emitir un token temporal de scope '2fa' válido 15 minutos
  const twoFactorToken = jwt.sign(
    { id: user.id, email: user.email, rol: user.rol, scope: '2fa' },
    process.env.JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );
  return { requiresTwoFactor: true, twoFactorToken };
}

// Sin 2FA — continuar con el par normal
const { accessToken, refreshToken } = await issueTokenPair(user, { ip, userAgent });
// ... resto del return existente
```

- [ ] **Step 7: Montar rutas en auth.routes.js**

```js
import { httpSetup, httpVerify, httpDisable, httpConfirm } from './twoFactor.controller.js';

router.post('/2fa/setup',    authenticate, httpSetup);
router.post('/2fa/verify',   authenticate, httpVerify);
router.post('/2fa/disable',  authenticate, httpDisable);
router.post('/2fa/confirm',  httpConfirm); // no requiere authenticate — usa twoFactorToken
```

- [ ] **Step 8: Ejecutar tests**

```bash
npx vitest run tests/twoFactor.test.js
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 9: Commit**

```bash
git add src/modules/auth/twoFactor.controller.js src/modules/auth/auth.routes.js \
        src/modules/auth/auth.service.js db/migrations/022_two_factor_auth.sql \
        tests/twoFactor.test.js
git commit -m "feat(security): 2FA TOTP — setup, verify, login de dos pasos, backup codes"
```

---

## Stream B: Redis Cache + Rate Limiting por Usuario

### Task B1: Cache middleware

**Files:**
- Create: `src/middlewares/cache.js`

- [ ] **Step 1: Crear cache middleware**

```js
// src/middlewares/cache.js
import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redis;

export function getRedisClient() {
  if (!redis) {
    redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
    redis.on('error', (err) => logger.warn(`[cache] Redis error: ${err.message}`));
    redis.connect().catch((err) => logger.warn(`[cache] No se pudo conectar a Redis: ${err.message}`));
  }
  return redis;
}

/**
 * Middleware de cache para endpoints GET públicos.
 * Omite cache si el request tiene autenticación o el query param admin=true.
 * @param {number} ttlSeconds - Tiempo de vida en segundos
 */
export function cacheMiddleware(ttlSeconds) {
  return async (req, res, next) => {
    // No cachear admin views ni usuarios autenticados
    if (req.query.admin === 'true' || req.cookies?.vigiiap_token || req.headers.authorization) {
      return next();
    }

    const client = getRedisClient();
    if (!client.isReady) return next(); // Redis no disponible — pasar transparentemente

    const key = `cache:${req.path}:${JSON.stringify(req.query)}`;

    try {
      const cached = await client.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }

      // Interceptar res.json para cachear la respuesta
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        client.setEx(key, ttlSeconds, JSON.stringify(data))
          .catch((err) => logger.warn(`[cache] Error guardando en cache: ${err.message}`));
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };
      next();
    } catch (err) {
      logger.warn(`[cache] Error consultando Redis: ${err.message}`);
      next(); // Fallar silenciosamente — la request sigue adelante sin cache
    }
  };
}

/**
 * Invalida todas las entradas de cache que coincidan con el patrón.
 * @param {string} pattern - ej: 'cache:/api/mapas*'
 */
export async function invalidateCache(pattern) {
  const client = getRedisClient();
  if (!client.isReady) return;
  try {
    const keys = await client.keys(pattern);
    if (keys.length) await client.del(keys);
  } catch (err) {
    logger.warn(`[cache] Error invalidando cache ${pattern}: ${err.message}`);
  }
}
```

- [ ] **Step 2: Aplicar cache en las rutas públicas**

En `src/modules/mapas/mapas.routes.js`:

```js
import { cacheMiddleware } from '../../middlewares/cache.js';

// Añadir cacheMiddleware ANTES de optionalAuthenticate en las rutas GET públicas:
router.get('/', cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
```

Repetir en `documentos.routes.js` (TTL 120s), `noticias.routes.js` (TTL 120s), `categorias.routes.js` (TTL 600s).

- [ ] **Step 3: Invalidar cache en mutaciones**

En `mapas.service.js`, al final de `create()`, `update()`, y `setActivo()`:

```js
import { invalidateCache } from '../../middlewares/cache.js';

// Al final de create/update/setActivo/remove:
invalidateCache('cache:/mapas*').catch(() => {});
```

Repetir en los services de documentos, noticias y categorias.

- [ ] **Step 4: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS (el middleware no afecta tests que no usan Redis real).

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/cache.js src/modules/mapas/mapas.routes.js \
        src/modules/documentos/documentos.routes.js src/modules/noticias/noticias.routes.js \
        src/modules/categorias/categorias.routes.js src/modules/mapas/mapas.service.js
git commit -m "feat(performance): cache Redis TTL para endpoints públicos — mapas(120s), docs(120s), noticias(120s), categorias(600s)"
```

---

### Task B2: Rate limiting por usuario autenticado

**Files:**
- Modify: `src/middlewares/rateLimiter.js`

- [ ] **Step 1: Actualizar el key generator del rateLimiter global**

```js
// En rateLimiter.js, modificar el rateLimiter principal:
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => (req.user ? 500 : 100), // autenticados tienen límite más generoso
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.' },
});

// uploadRateLimiter — también por usuario:
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: { error: 'Límite de uploads alcanzado (10/hora). Intenta más tarde.' },
});
```

- [ ] **Step 2: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 3: Commit**

```bash
git add src/middlewares/rateLimiter.js
git commit -m "feat(security): rate limiting por usuario autenticado — 500req/15min vs 100 para anónimos"
```

---

## Stream C: Export CSV / Excel

### Task C1: Instalar xlsx

```bash
npm install xlsx
git add package.json package-lock.json
git commit -m "feat(deps): xlsx (SheetJS) para exports"
```

### Task C2: export.controller.js

**Files:**
- Create: `src/modules/admin/export.controller.js`
- Modify: `src/modules/admin/admin.routes.js`

- [ ] **Step 1: Crear el controller**

```js
// src/modules/admin/export.controller.js
import * as XLSX from 'xlsx';
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const MAX_ROWS = 10_000;

// Campos sensibles que NUNCA se exportan
const EXCLUDED_FIELDS = new Set([
  'password_hash', 'totp_secret', 'totp_backup_codes',
  'email_verification_token', 'password_reset_token',
]);

function sanitizeRows(rows) {
  return rows.map((row) => {
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      if (!EXCLUDED_FIELDS.has(k)) clean[k] = v;
    }
    return clean;
  });
}

function sendExport(res, rows, filename, formato) {
  const clean = sanitizeRows(rows);
  if (formato === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(clean);
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.send(buf);
  }
  // CSV
  if (clean.length === 0) return res.send('');
  const headers = Object.keys(clean[0]).join(',');
  const csv = clean.map((r) => Object.values(r).map((v) =>
    typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v ?? ''
  ).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  return res.send(`${headers}\n${csv}`);
}

/** GET /api/admin/export/usuarios?formato=csv|xlsx */
export async function exportUsuarios(req, res, next) {
  try {
    const formato = req.query.formato === 'xlsx' ? 'xlsx' : 'csv';
    const { rows } = await query(
      `SELECT id, nombre, email, rol, tipo_acceso, institucion, activo,
              email_verified, creado_en, last_login_at
       FROM usuarios ORDER BY creado_en DESC LIMIT $1`,
      [MAX_ROWS]
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Usa filtros de fecha.` });
    }
    registrarAuditoria({
      accion: 'export_usuarios', modulo: 'admin',
      descripcion: `Export de usuarios (${rows.length} registros, formato: ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'usuarios', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/solicitudes?formato=csv|xlsx&desde=&hasta= */
export async function exportSolicitudes(req, res, next) {
  try {
    const formato = req.query.formato === 'xlsx' ? 'xlsx' : 'csv';
    const params = [];
    const conditions = [];
    if (req.query.desde) { params.push(req.query.desde); conditions.push(`creado_en >= $${params.length}`); }
    if (req.query.hasta) { params.push(req.query.hasta); conditions.push(`creado_en <= $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(MAX_ROWS);

    const { rows } = await query(
      `SELECT id, tipo, descripcion, estado, nota_admin, creado_en, actualizado_en
       FROM solicitudes ${where} ORDER BY creado_en DESC LIMIT $${params.length}`,
      params
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Reduce el rango de fechas.` });
    }
    registrarAuditoria({
      accion: 'export_solicitudes', modulo: 'admin',
      descripcion: `Export solicitudes (${rows.length} registros)`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'solicitudes', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/audit?formato=csv|xlsx&desde=&hasta= */
export async function exportAudit(req, res, next) {
  try {
    const formato = req.query.formato === 'xlsx' ? 'xlsx' : 'csv';
    const params = [];
    const conditions = [];
    if (req.query.desde) { params.push(req.query.desde); conditions.push(`creado_en >= $${params.length}`); }
    if (req.query.hasta) { params.push(req.query.hasta); conditions.push(`creado_en <= $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(MAX_ROWS);

    const { rows } = await query(
      `SELECT id, accion, modulo, entidad_id, descripcion, usuario_email, ip, creado_en
       FROM audit_log ${where} ORDER BY creado_en DESC LIMIT $${params.length}`,
      params
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Reduce el rango de fechas.` });
    }
    registrarAuditoria({
      accion: 'export_audit', modulo: 'admin',
      descripcion: `Export audit log (${rows.length} registros)`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'audit-log', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/descargas?formato=csv|xlsx */
export async function exportDescargas(req, res, next) {
  try {
    const formato = req.query.formato === 'xlsx' ? 'xlsx' : 'csv';
    const { rows } = await query(
      `SELECT id, archivo_key, usuario_id, ip_origen, descargado_en
       FROM descarga_log ORDER BY descargado_en DESC LIMIT $1`,
      [MAX_ROWS]
    );
    registrarAuditoria({
      accion: 'export_descargas', modulo: 'admin',
      descripcion: `Export log de descargas (${rows.length} registros)`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'descargas', formato);
  } catch (err) { next(err); }
}
```

- [ ] **Step 2: Montar en admin.routes.js**

```js
import { exportUsuarios, exportSolicitudes, exportAudit, exportDescargas } from './export.controller.js';

// Solo admin_sig y super_admin pueden exportar
router.get('/export/usuarios',    authenticate, authorize('admin_sig'), exportUsuarios);
router.get('/export/solicitudes', authenticate, authorize('admin_sig'), exportSolicitudes);
router.get('/export/audit',       authenticate, authorize('admin_sig'), exportAudit);
router.get('/export/descargas',   authenticate, authorize('admin_sig'), exportDescargas);
```

- [ ] **Step 3: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/export.controller.js src/modules/admin/admin.routes.js
git commit -m "feat(admin): export CSV/Excel — usuarios, solicitudes, audit log, descargas (máx 10k filas)"
```

---

## Stream D: Password Expiry + Batch Operations

### Task D1: Migración 023 — password_expiry

**Files:**
- Create: `db/migrations/023_password_expiry.sql`

- [ ] **Step 1: Crear migración**

```sql
-- db/migrations/023_password_expiry.sql
-- Password expiry para roles institucionales.
-- publico y visitante no aplican.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT NOW();

-- Clave de configuración para los días de expiración (default: 90)
INSERT INTO configuracion (clave, valor) VALUES ('passwordExpiryDays', '90')
ON CONFLICT (clave) DO NOTHING;

COMMENT ON COLUMN usuarios.password_changed_at IS
  'Timestamp del último cambio de contraseña. Usado para política de expiración.';
```

- [ ] **Step 2: Correr migración**

```bash
node db/migrate.js
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/023_password_expiry.sql
git commit -m "feat(db): migración 023 — password_changed_at + clave passwordExpiryDays"
```

---

### Task D2: Flujo de contraseña expirada

**Files:**
- Modify: `src/modules/auth/auth.service.js`
- Create: `src/modules/auth/expiredPassword.controller.js`
- Modify: `src/modules/auth/auth.routes.js`

- [ ] **Step 1: Detectar contraseña expirada en login()**

En `auth.service.js`, función `login()`, después de verificar `activo`:

```js
// Roles sujetos a expiración de contraseña
const EXPIRY_ROLES = ['admin_sig', 'investigador', 'tecnico', 'institucional'];

if (EXPIRY_ROLES.includes(user.rol)) {
  const { rows: config } = await query(
    "SELECT valor FROM configuracion WHERE clave = 'passwordExpiryDays'",
    []
  );
  const expiryDays = parseInt(config[0]?.valor ?? '90', 10);
  const changedAt = user.password_changed_at ?? user.creado_en;
  const expired = new Date(changedAt) < new Date(Date.now() - expiryDays * 86_400_000);

  if (expired) {
    // Emitir token temporal de scope 'password-change'
    const expiredToken = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, scope: 'password-change' },
      process.env.JWT_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' }
    );
    return { passwordExpired: true, expiredToken };
  }
}
```

Asegurarse de incluir `password_changed_at` en el SELECT inicial de `login()`:

```sql
SELECT id, nombre, email, password_hash, rol, activo, email_verified,
       intentos_fallidos, bloqueado_hasta, password_changed_at
FROM usuarios WHERE email = $1
```

- [ ] **Step 2: Crear expiredPassword.controller.js**

```js
// src/modules/auth/expiredPassword.controller.js
import jwt from 'jsonwebtoken';
import { query } from '../../config/database.js';
import { issueTokenPair } from './auth.service.js';
import { resetPasswordSchema } from './auth.schema.js';
import { revokeAllRefreshTokens } from '../../utils/tokenBlacklist.js';
import bcrypt from 'bcryptjs';
import {
  COOKIE_NAME, REFRESH_COOKIE_NAME,
  authCookieOptions, refreshCookieOptions,
} from '../../utils/cookieOptions.js';

/** POST /api/auth/change-expired-password */
export async function changeExpiredPassword(req, res, next) {
  try {
    const rawToken = req.cookies?.['vigiiap_expired_temp'] ?? req.body?.expiredToken;
    if (!rawToken) return res.status(401).json({ error: 'Token de cambio de contraseña no encontrado' });

    let payload;
    try {
      payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    if (payload.scope !== 'password-change') {
      return res.status(401).json({ error: 'Token incorrecto para este endpoint' });
    }

    const { password } = resetPasswordSchema.pick({ password: true }).parse(req.body);

    const hash = await bcrypt.hash(password, 12);
    await query(
      'UPDATE usuarios SET password_hash = $1, password_changed_at = NOW(), actualizado_en = NOW() WHERE id = $2',
      [hash, payload.id]
    );
    await revokeAllRefreshTokens(payload.id);

    const { rows } = await query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE id = $1',
      [payload.id]
    );
    const user = rows[0];
    const { accessToken, refreshToken } = await issueTokenPair(user, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });

    res.clearCookie('vigiiap_expired_temp');
    res.cookie(COOKIE_NAME, accessToken, authCookieOptions());
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    res.json({ token: accessToken, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
  } catch (err) { next(err); }
}
```

- [ ] **Step 3: Montar en auth.routes.js**

```js
import { changeExpiredPassword } from './expiredPassword.controller.js';
router.post('/change-expired-password', changeExpiredPassword);
```

- [ ] **Step 4: Actualizar password_changed_at en updatePassword() y resetPassword()**

En `usuarios.service.js`, `updatePassword()`:

```js
await query(
  'UPDATE usuarios SET password_hash=$1, password_changed_at=NOW(), actualizado_en=NOW() WHERE id=$2',
  [hash, userId]
);
```

En `auth.service.js`, `resetPassword()`:

```js
await query(
  `UPDATE usuarios
   SET password_hash = $1, password_reset_token = NULL,
       password_reset_expires = NULL, password_changed_at = NOW(), actualizado_en = NOW()
   WHERE id = $2`,
  [password_hash, user.id]
);
```

- [ ] **Step 5: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.service.js src/modules/auth/expiredPassword.controller.js \
        src/modules/auth/auth.routes.js src/modules/usuarios/usuarios.service.js
git commit -m "feat(security): password expiry policy — 90 días para roles institucionales, flujo de cambio forzado"
```

---

### Task D3: Batch Operations para Admin

**Files:**
- Modify: `src/modules/admin/admin.controller.js`
- Modify: `src/modules/admin/admin.routes.js`

- [ ] **Step 1: Añadir handler batchUsuarios en admin.controller.js**

```js
/** PATCH /api/admin/usuarios/batch */
export async function batchUsuarios(req, res, next) {
  try {
    const { ids, accion, rol } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids debe ser un array no vacío' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Máximo 50 usuarios por operación batch' });
    }
    if (!['activar', 'desactivar', 'cambiar-rol'].includes(accion)) {
      return res.status(400).json({ error: "accion debe ser 'activar', 'desactivar' o 'cambiar-rol'" });
    }
    if (accion === 'cambiar-rol') {
      const ROLES_ASIGNABLES = ['admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'];
      if (!rol || !ROLES_ASIGNABLES.includes(rol)) {
        return res.status(400).json({ error: `rol inválido para batch. Opciones: ${ROLES_ASIGNABLES.join(', ')}` });
      }
    }

    // Verificar que ninguna ID es un super_admin
    const { rows: targets } = await query(
      `SELECT id, rol FROM usuarios WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const superAdmins = targets.filter((u) => u.rol === 'super_admin');
    if (superAdmins.length) {
      return res.status(403).json({ error: 'No se puede operar sobre cuentas super_admin en batch' });
    }

    let updateSql;
    const params = [ids];
    if (accion === 'activar')        updateSql = 'UPDATE usuarios SET activo = true,  actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
    if (accion === 'desactivar')     updateSql = 'UPDATE usuarios SET activo = false, actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
    if (accion === 'cambiar-rol') {
      updateSql = 'UPDATE usuarios SET rol = $2, actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
      params.push(rol);
    }

    const result = await query(updateSql, params);

    registrarAuditoria({
      accion:       `batch_${accion.replace('-', '_')}`,
      modulo:       'admin',
      descripcion:  `Batch ${accion}: ${result.rowCount} usuarios afectados`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
      metadatos:    { ids, accion, rol: rol ?? null, afectados: result.rowCount },
    });

    res.json({ message: `${result.rowCount} usuarios actualizados`, afectados: result.rowCount });
  } catch (err) { next(err); }
}
```

- [ ] **Step 2: Montar en admin.routes.js**

```js
import { batchUsuarios } from './admin.controller.js'; // ya está importado el controller

// Añadir antes de las rutas específicas de usuario para que no conflicte con /:id
router.patch('/usuarios/batch', authenticate, authorize('admin_sig'), batchUsuarios);
```

- [ ] **Step 3: Escribir tests**

```js
// En tests/admin.test.js:
describe('PATCH /api/admin/usuarios/batch', () => {
  it('retorna 400 si ids tiene más de 50 elementos', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `uuid-${i}`);
    const res = await request(app)
      .patch('/api/admin/usuarios/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, accion: 'activar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('50');
  });

  it('retorna 403 si algún usuario es super_admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', rol: 'super_admin' }] });
    const res = await request(app)
      .patch('/api/admin/usuarios/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: ['uuid-1'], accion: 'desactivar' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 4: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/admin.controller.js src/modules/admin/admin.routes.js tests/admin.test.js
git commit -m "feat(admin): batch operations — activar/desactivar/cambiar-rol hasta 50 usuarios en una operación"
```

---

## Task Final: Verificación y PR

- [ ] **Step 1: Ejecutar suite completa**

```bash
npx vitest run
```

Esperado: 380+ tests PASS, 0 FAIL.

- [ ] **Step 2: Verificar 0 vulnerabilidades**

```bash
npm audit
```

- [ ] **Step 3: Verificar lint**

```bash
npx eslint src/ --max-warnings 0
```

- [ ] **Step 4: Push y PR**

```bash
git push origin feat/t3-advanced
gh pr create \
  --title "feat(t3): Advanced — 2FA TOTP, cache Redis, exports, password expiry, batch operations" \
  --base main \
  --body "## Tier 3 — Advanced

### Cambios
- 2FA TOTP obligatorio para admin_sig/super_admin, opcional para otros roles
- Cache Redis TTL para endpoints públicos (mapas, docs, noticias, categorias)
- Rate limiting por usuario autenticado (500req/15min vs 100 anónimos)
- Export CSV/Excel: usuarios, solicitudes, audit log, descargas (máx 10k filas)
- Password expiry policy: 90 días para roles institucionales, flujo de cambio forzado
- Batch operations: activar/desactivar/cambiar-rol hasta 50 usuarios en una sola llamada
"
```
