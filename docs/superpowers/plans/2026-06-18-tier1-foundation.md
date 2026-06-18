# Tier 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 9 gaps de seguridad y calidad identificados en la auditoría — base sólida sobre la que T2 y T3 construyen.

**Architecture:** Cambios quirúrgicos en archivos existentes más un middleware nuevo (requestId) y una migración (020_last_login). No hay nuevas rutas públicas ni dependencias externas. Todo se implementa con TDD — test primero, luego implementación mínima.

**Tech Stack:** Node.js 20 ES Modules, Express 4, PostgreSQL via `pg`, Vitest, Zod

---

## File Map

| Acción | Archivo | Qué cambia |
|--------|---------|------------|
| CREATE | `db/migrations/020_last_login.sql` | Columna `last_login_at` en usuarios |
| CREATE | `src/middlewares/requestId.js` | Middleware X-Request-Id |
| MODIFY | `src/app.js` | Health check con DB ping, montar requestId middleware |
| MODIFY | `src/modules/auth/auth.schema.js` | Max lengths en campos de texto |
| MODIFY | `src/modules/auth/auth.service.js` | last_login_at en login(), revocar sesiones en resetPassword() |
| MODIFY | `src/modules/auth/auth.controller.js` | Invalidar sesiones en logout visitante, fix `{ message }` → `{ error }` |
| MODIFY | `src/modules/usuarios/usuarios.service.js` | updatePassword() revoca sesiones |
| MODIFY | `src/modules/usuarios/usuarios.controller.js` | Blacklistear token actual + limpiar cookies tras changePassword |
| MODIFY | `src/modules/solicitudes/solicitudes.schema.js` | Max length en descripcion |
| MODIFY | `src/modules/admin/admin.controller.js` | Fix `{ message }` → `{ error }` en caso de error inline |
| MODIFY | `server.js` | Validación ENV de email |
| MODIFY | `tests/auth.service.test.js` | Tests para last_login_at y revokeAllRefreshTokens en resetPassword |
| MODIFY | `tests/usuarios.service.test.js` | Test para revokeAllRefreshTokens en updatePassword |
| CREATE | `tests/requestId.test.js` | Test del middleware X-Request-Id |

---

## Task 1: Migración 020 — last_login_at

**Files:**
- Create: `db/migrations/020_last_login.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- db/migrations/020_last_login.sql
-- 020: Registro de último acceso por usuario
-- Permite detectar cuentas inactivas y auditar patrones de acceso.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_last_login
  ON usuarios (last_login_at)
  WHERE last_login_at IS NOT NULL;

COMMENT ON COLUMN usuarios.last_login_at IS
  'Timestamp del último login exitoso. NULL si el usuario nunca ha iniciado sesión.';
```

- [ ] **Step 2: Verificar que el runner de migraciones la reconoce**

```bash
node db/migrate.js
```

Esperado: `[migrate] 020_last_login.sql aplicada` (o `ya aplicada` si la BD está disponible).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/020_last_login.sql
git commit -m "feat(db): migración 020 — columna last_login_at en usuarios"
```

---

## Task 2: last_login_at en login()

**Files:**
- Modify: `src/modules/auth/auth.service.js`
- Modify: `tests/auth.service.test.js`

- [ ] **Step 1: Escribir el test fallido**

En `tests/auth.service.test.js`, dentro del `describe('login()')`, añadir:

```js
it('actualiza last_login_at en login exitoso', async () => {
  const mockUser = {
    id: 'uuid-001', nombre: 'Admin', email: 'admin@iiap.gob.pe',
    password_hash: '$2a$12$hash', rol: 'admin_sig',
    activo: true, email_verified: true,
    intentos_fallidos: 0, bloqueado_hasta: null,
  };
  query
    .mockResolvedValueOnce({ rows: [mockUser] })  // SELECT usuario
    .mockResolvedValueOnce({ rows: [] });          // UPDATE last_login_at
  bcrypt.compare.mockResolvedValueOnce(true);

  await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

  // El segundo query debe incluir last_login_at
  const updateCall = query.mock.calls.find(
    ([sql]) => sql.includes('last_login_at')
  );
  expect(updateCall).toBeDefined();
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/auth.service.test.js
```

Esperado: FAIL — `Expected updateCall to be defined` (el query actual no toca last_login_at).

- [ ] **Step 3: Implementar en auth.service.js**

Buscar el bloque que resetea `intentos_fallidos` tras login exitoso:

```js
// ANTES (línea ~75):
if (user.intentos_fallidos > 0 || user.bloqueado_hasta) {
  await query(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1',
    [user.id]
  );
}
```

Reemplazar por (siempre actualizar last_login_at, independientemente de intentos_fallidos):

```js
await query(
  'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, last_login_at = NOW() WHERE id = $1',
  [user.id]
);
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
npx vitest run tests/auth.service.test.js
```

Esperado: PASS en todos los tests de login().

- [ ] **Step 5: Exponer last_login_at en getProfile()**

En `auth.service.js`, función `getProfile()`:

```js
// ANTES:
'SELECT id, nombre, email, rol, tipo_acceso, institucion, creado_en FROM usuarios WHERE id = $1',

// DESPUÉS:
'SELECT id, nombre, email, rol, tipo_acceso, institucion, creado_en, last_login_at FROM usuarios WHERE id = $1',
```

También en `usuarios.service.js`, función `getAll()`:

```js
// ANTES:
`SELECT id, nombre, email, rol, institucion, activo, creado_en

// DESPUÉS:
`SELECT id, nombre, email, rol, institucion, activo, creado_en, last_login_at
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.service.js src/modules/usuarios/usuarios.service.js tests/auth.service.test.js
git commit -m "feat(auth): last_login_at actualizado en login exitoso"
```

---

## Task 3: Invalidar sesiones en resetPassword()

**Files:**
- Modify: `src/modules/auth/auth.service.js`
- Modify: `tests/auth.service.test.js`

- [ ] **Step 1: Añadir mock de revokeAllRefreshTokens al setup del test**

Al inicio de `tests/auth.service.test.js`, en el bloque de mocks:

```js
vi.mock('../src/utils/tokenBlacklist.js', () => ({
  isRevoked: vi.fn().mockReturnValue(false),
  revokeToken: vi.fn().mockResolvedValue(undefined),
  loadBlacklist: vi.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 2: Escribir el test fallido para resetPassword**

```js
describe('resetPassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca todas las sesiones activas tras resetear contraseña', async () => {
    const mockUser = {
      id: 'uuid-001',
      email: 'admin@iiap.gob.pe',
      password_reset_expires: new Date(Date.now() + 60_000).toISOString(),
    };
    query
      .mockResolvedValueOnce({ rows: [mockUser] })   // SELECT por token hash
      .mockResolvedValueOnce({ rows: [] });            // UPDATE password
    bcrypt.hash.mockResolvedValueOnce('$2a$12$newhash');

    // revokeAllRefreshTokens es llamada con el userId
    const { revokeAllRefreshTokens } = await import('../src/modules/auth/auth.service.js');
    // Verificar que el service fue importado; el mock del query capturará la llamada
    await resetPassword('raw-token-64chars', 'NuevaPass123!');

    // Debe haber un UPDATE de refresh_tokens (revokeAllRefreshTokens)
    const revokeCall = query.mock.calls.find(
      ([sql]) => sql.includes('refresh_tokens') && sql.includes('revocado = true')
    );
    expect(revokeCall).toBeDefined();
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
npx vitest run tests/auth.service.test.js
```

Esperado: FAIL — `Expected revokeCall to be defined`.

- [ ] **Step 4: Implementar en auth.service.js**

En `resetPassword()`, al final, antes del `return { email: user.email }`:

```js
// ANTES (final de resetPassword):
  await query(
    `UPDATE usuarios
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires = NULL,
         actualizado_en = NOW()
     WHERE id = $2`,
    [password_hash, user.id]
  );

  return { email: user.email };
}
```

```js
// DESPUÉS:
  await query(
    `UPDATE usuarios
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires = NULL,
         actualizado_en = NOW()
     WHERE id = $2`,
    [password_hash, user.id]
  );

  // Revocar todas las sesiones activas — alguien que recupera su cuenta
  // debe invalidar cualquier sesión previa que pudiera estar comprometida.
  await revokeAllRefreshTokens(user.id);

  return { email: user.email };
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

```bash
npx vitest run tests/auth.service.test.js
```

Esperado: PASS en todos los tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.service.js tests/auth.service.test.js
git commit -m "fix(security): resetPassword revoca todas las sesiones activas"
```

---

## Task 4: Invalidar sesiones en changePassword()

**Files:**
- Modify: `src/modules/usuarios/usuarios.service.js`
- Modify: `src/modules/usuarios/usuarios.controller.js`
- Modify: `tests/usuarios.service.test.js`

- [ ] **Step 1: Escribir test fallido en usuarios.service.test.js**

```js
describe('updatePassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca todas las sesiones activas tras actualizar contraseña', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ password_hash: '$2a$12$oldhash' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE password
    bcrypt.compare.mockResolvedValueOnce(true);
    bcrypt.hash.mockResolvedValueOnce('$2a$12$newhash');

    await updatePassword('uuid-001', 'OldPass123!', 'NewPass123!');

    const revokeCall = query.mock.calls.find(
      ([sql]) => sql.includes('refresh_tokens') && sql.includes('revocado = true')
    );
    expect(revokeCall).toBeDefined();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/usuarios.service.test.js
```

Esperado: FAIL.

- [ ] **Step 3: Implementar en usuarios.service.js**

Primero añadir el import al inicio del archivo:

```js
import { revokeAllRefreshTokens } from '../../utils/tokenBlacklist.js';
```

Luego en `updatePassword()`, al final:

```js
// ANTES:
  await query('UPDATE usuarios SET password_hash=$1, actualizado_en=NOW() WHERE id=$2', [hash, userId]);
}

// DESPUÉS:
  await query('UPDATE usuarios SET password_hash=$1, actualizado_en=NOW() WHERE id=$2', [hash, userId]);
  await revokeAllRefreshTokens(userId);
}
```

- [ ] **Step 4: Verificar que el test pasa**

```bash
npx vitest run tests/usuarios.service.test.js
```

Esperado: PASS.

- [ ] **Step 5: Blacklistear el access token actual en el controller**

En `src/modules/usuarios/usuarios.controller.js`, añadir imports al inicio:

```js
import { revokeToken } from '../../utils/tokenBlacklist.js';
import {
  COOKIE_NAME, clearCookieOptions,
  REFRESH_COOKIE_NAME, clearRefreshCookieOptions,
} from '../../utils/cookieOptions.js';
```

Luego en `changePassword()`:

```js
// ANTES:
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);
    await userService.updatePassword(req.user.id, currentPassword, newPassword);
    registrarAuditoria({
      accion: 'change_password', modulo: 'usuarios', entidadId: req.user.id,
      descripcion: 'Usuario cambió su contraseña',
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { next(err); }
}

// DESPUÉS:
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);
    await userService.updatePassword(req.user.id, currentPassword, newPassword);

    // Blacklistear el access token actual para que no siga siendo válido
    const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.slice(7);
    if (token && req.user?.exp) {
      await revokeToken(token, req.user.exp);
    }

    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());

    registrarAuditoria({
      accion: 'change_password', modulo: 'usuarios', entidadId: req.user.id,
      descripcion: 'Usuario cambió su contraseña — sesiones revocadas',
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    res.json({ message: 'Contraseña actualizada. Por seguridad, inicia sesión nuevamente.' });
  } catch (err) { next(err); }
}
```

- [ ] **Step 6: Ejecutar todos los tests**

```bash
npx vitest run
```

Esperado: 281+ tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/usuarios/usuarios.service.js src/modules/usuarios/usuarios.controller.js tests/usuarios.service.test.js
git commit -m "fix(security): changePassword revoca todas las sesiones y blacklistea el token actual"
```

---

## Task 5: Health Check con DB ping

**Files:**
- Modify: `src/app.js`
- Modify: `tests/auth.test.js` (añadir test de health)

- [ ] **Step 1: Escribir el test fallido**

En `tests/auth.test.js` (o crear `tests/health.test.js`):

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  connectDB: vi.fn(),
  default: { end: vi.fn() },
}));

import { query } from '../src/config/database.js';
import request from 'supertest';
import app from '../src/app.js';

describe('GET /health', () => {
  it('retorna 200 con db:ok cuando la BD responde', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });

  it('retorna 503 con status:degraded cuando la BD falla', async () => {
    query.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('unreachable');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/health.test.js
```

Esperado: FAIL — el health actual no hace ping a BD.

- [ ] **Step 3: Implementar en app.js**

Primero verificar que `query` está importado en `app.js`. Si no está, añadir al inicio:

```js
import { query } from './config/database.js';
```

Luego reemplazar el handler de `/health`:

```js
// REEMPLAZAR el bloque completo de /health por:
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      db: 'ok',
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
npx vitest run tests/health.test.js
```

Esperado: PASS en ambos tests.

- [ ] **Step 5: Ejecutar toda la suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 6: Commit**

```bash
git add src/app.js tests/health.test.js
git commit -m "feat(ops): /health verifica conectividad BD — retorna 503 si está caída"
```

---

## Task 6: X-Request-Id middleware

**Files:**
- Create: `src/middlewares/requestId.js`
- Modify: `src/app.js`
- Create: `tests/requestId.test.js`

- [ ] **Step 1: Escribir el test fallido**

```js
// tests/requestId.test.js
import { describe, it, expect } from 'vitest';
import { requestId } from '../src/middlewares/requestId.js';

describe('requestId middleware', () => {
  function makeReqRes(headers = {}) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    return [{ headers, requestId: undefined }, res, () => {}];
  }

  it('genera UUID si el cliente no envía X-Request-Id', () => {
    const [req, res, next] = makeReqRes();
    requestId(req, res, next);
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(res.headers['X-Request-Id']).toBe(req.requestId);
  });

  it('reutiliza el X-Request-Id del cliente si viene en el header', () => {
    const [req, res, next] = makeReqRes({ 'x-request-id': 'client-id-abc' });
    requestId(req, res, next);
    expect(req.requestId).toBe('client-id-abc');
    expect(res.headers['X-Request-Id']).toBe('client-id-abc');
  });

  it('llama a next()', () => {
    let called = false;
    const [req, res] = makeReqRes();
    requestId(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/requestId.test.js
```

Esperado: FAIL — el archivo no existe.

- [ ] **Step 3: Crear src/middlewares/requestId.js**

```js
import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] ?? randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
npx vitest run tests/requestId.test.js
```

Esperado: PASS en los 3 tests.

- [ ] **Step 5: Registrar en app.js como primer middleware tras helmet**

```js
// Añadir import al inicio de app.js:
import { requestId } from './middlewares/requestId.js';

// En el cuerpo, DESPUÉS de app.use(helmet(...)) y ANTES de cors():
app.use(requestId);
```

- [ ] **Step 6: Ejecutar toda la suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 7: Commit**

```bash
git add src/middlewares/requestId.js src/app.js tests/requestId.test.js
git commit -m "feat(observabilidad): middleware X-Request-Id para correlación de logs"
```

---

## Task 7: Schema max lengths

**Files:**
- Modify: `src/modules/auth/auth.schema.js`
- Modify: `src/modules/solicitudes/solicitudes.schema.js`

- [ ] **Step 1: Escribir tests fallidos**

Crear `tests/schemas.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { registerSchema } from '../src/modules/auth/auth.schema.js';
import { createSolicitudSchema } from '../src/modules/solicitudes/solicitudes.schema.js';

describe('registerSchema — max lengths', () => {
  const base = {
    nombre: 'Juan', email: 'juan@iiap.gob.co',
    password: 'Segura123!', tipoAcceso: 'externo',
  };

  it('rechaza nombre > 150 chars', () => {
    expect(() => registerSchema.parse({ ...base, nombre: 'a'.repeat(151) })).toThrow();
  });

  it('rechaza institucion > 300 chars', () => {
    expect(() => registerSchema.parse({ ...base, institucion: 'a'.repeat(301) })).toThrow();
  });

  it('rechaza motivo > 500 chars', () => {
    expect(() => registerSchema.parse({ ...base, motivo: 'a'.repeat(501) })).toThrow();
  });

  it('rechaza email > 254 chars', () => {
    const longEmail = 'a'.repeat(244) + '@iiap.co';
    expect(() => registerSchema.parse({ ...base, email: longEmail })).toThrow();
  });
});

describe('createSolicitudSchema — max lengths', () => {
  it('rechaza descripcion > 1000 chars', () => {
    expect(() => createSolicitudSchema.parse({
      tipo: 'otro',
      descripcion: 'a'.repeat(1001),
    })).toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/schemas.test.js
```

Esperado: FAIL — los campos no tienen límite superior.

- [ ] **Step 3: Actualizar auth.schema.js**

```js
export const loginSchema = z.object({
  email: z.string().email('Email inválido').max(254),
  password: z.string().min(8, 'Contraseña mínimo 8 caracteres').max(72),
});

// registerSchema:
export const registerSchema = z.object({
  nombre:      z.string().min(2, 'Nombre requerido').max(150),
  email:       z.string().email('Email inválido').max(254),
  password:    strongPassword,
  institucion: z.string().max(300).optional(),
  motivo:      z.string().max(500).optional(),
  perfil:      z.enum(['investigador', 'tecnico', 'institucional', 'publico']).optional(),
  tipoAcceso:  z.enum(['institucional', 'externo']).optional().default('externo'),
});

export const recoverSchema = z.object({
  email: z.string().email('Email inválido').max(254),
});
```

- [ ] **Step 4: Actualizar solicitudes.schema.js**

```js
export const createSolicitudSchema = z.object({
  tipo:        z.enum(TIPOS, { errorMap: () => ({ message: `Tipo debe ser uno de: ${TIPOS.join(', ')}` }) }),
  descripcion: z.string().min(10, 'Descripción mínimo 10 caracteres').max(1000),
});
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

```bash
npx vitest run tests/schemas.test.js
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.schema.js src/modules/solicitudes/solicitudes.schema.js tests/schemas.test.js
git commit -m "fix(validation): max lengths en schemas — nombre(150), institucion(300), motivo(500), descripcion(1000), email(254)"
```

---

## Task 8: Estandarizar formato de error

**Files:**
- Modify: `src/modules/auth/auth.controller.js`
- Modify: `src/modules/admin/admin.controller.js`

- [ ] **Step 1: Identificar y corregir los 2 casos**

En `src/modules/auth/auth.controller.js`, línea ~178:

```js
// ANTES:
if (!email) return res.status(400).json({ message: 'Email requerido' });

// DESPUÉS:
if (!email) return res.status(400).json({ error: 'Email requerido' });
```

En `src/modules/admin/admin.controller.js`, línea ~100:

```js
// ANTES:
return res.status(400).json({ message: 'nombre, email y rol son obligatorios' });

// DESPUÉS:
return res.status(400).json({ error: 'nombre, email y rol son obligatorios' });
```

- [ ] **Step 2: Verificar que no hay otros casos de `{ message }` en errores**

```bash
grep -rn "res.status.*json.*message" src/modules/
```

Esperado: Solo aparecen en respuestas de éxito (logout, password change, etc.) — esos son correctos.

- [ ] **Step 3: Ejecutar toda la suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/auth.controller.js src/modules/admin/admin.controller.js
git commit -m "fix(api): estandarizar errores inline a { error } en lugar de { message }"
```

---

## Task 9: Validación ENV completa en startup

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Actualizar validateEnv() en server.js**

```js
function validateEnv() {
  if (!process.env.JWT_SECRET) {
    logger.error('[startup] FATAL: JWT_SECRET no está definida. El servidor no puede arrancar de forma segura.');
    process.exit(1);
  }

  const r2Vars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
  const missingR2 = r2Vars.filter((k) => !process.env[k]);
  if (missingR2.length) {
    logger.warn(`[startup] R2 no configurado (${missingR2.join(', ')}) — los uploads de archivos fallarán.`);
  }

  const emailVars = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM'];
  const missingEmail = emailVars.filter((k) => !process.env[k]);
  if (missingEmail.length) {
    logger.warn(`[startup] Email no configurado (${missingEmail.join(', ')}) — las notificaciones por email estarán desactivadas.`);
  }

  if (!process.env.FRONTEND_URL) {
    logger.warn('[startup] FRONTEND_URL no definida — los links en emails usarán el valor por defecto.');
  } else {
    logger.info(`[startup] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  }
}
```

- [ ] **Step 2: Ejecutar toda la suite**

```bash
npx vitest run
```

Esperado: PASS en todos (setup.js no define MAIL_* vars, así que el warning se disparará en dev — correcto).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(ops): validación de variables de entorno de email al arrancar"
```

---

## Task 10: Verificación final y PR

- [ ] **Step 1: Ejecutar suite completa**

```bash
npx vitest run
```

Esperado: 290+ tests PASS, 0 FAIL.

- [ ] **Step 2: Verificar 0 vulnerabilidades**

```bash
npm audit
```

Esperado: `found 0 vulnerabilities`.

- [ ] **Step 3: Verificar lint**

```bash
npx eslint src/ --max-warnings 0
```

Esperado: Sin errores.

- [ ] **Step 4: Push y PR**

```bash
git push origin feat/audit-remaining-fixes
gh pr create \
  --title "feat(t1): Foundation — 9 gaps de seguridad y calidad cerrados" \
  --base main \
  --body "## Tier 1 — Foundation

Cierra todos los gaps identificados en la auditoría de seguridad.

### Cambios
- Password change + reset invalidan todas las sesiones activas
- /health verifica conectividad con BD (503 si está caída)
- Schema max lengths: nombre(150), institucion(300), motivo(500), descripcion(1000)
- X-Request-Id en todos los responses para correlación de logs
- last_login_at actualizado en cada login exitoso
- Validación ENV de email al arrancar
- Error format estandarizado a { error } en todos los 4xx

### Tests
$(npx vitest run 2>&1 | grep 'Tests\s')
"
```
