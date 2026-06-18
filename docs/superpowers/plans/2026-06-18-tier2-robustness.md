# Tier 2 — Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir capacidades que un sistema de producción gubernamental debe tener: soft deletes, email resiliente con retry, session management, OpenAPI completa, y observabilidad básica.

**Architecture:** Cuatro streams paralelos: (A) soft deletes + migraciones, (B) BullMQ email queue, (C) session management API, (D) OpenAPI + observabilidad. Cada stream es independiente y puede mergearse en cualquier orden. Requiere T1 mergeado primero.

**Tech Stack:** Node.js 20 ES Modules, Express 4, PostgreSQL, BullMQ, ioredis, Vitest

**Pre-requisito:** `npm install bullmq ioredis` y variable `REDIS_URL` en `.env`.

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| CREATE | `db/migrations/021_soft_deletes.sql` | Columnas deleted_at + índices parciales |
| MODIFY | `src/modules/mapas/mapas.service.js` | WHERE deleted_at IS NULL, remove() soft |
| MODIFY | `src/modules/documentos/documentos.service.js` | Ídem |
| MODIFY | `src/modules/noticias/noticias.service.js` | Ídem |
| MODIFY | `src/modules/categorias/categorias.service.js` | Ídem |
| CREATE | `src/modules/admin/papelera.controller.js` | GET papelera, PATCH restaurar |
| MODIFY | `src/modules/admin/admin.routes.js` | Montar papelera endpoints |
| CREATE | `src/utils/emailQueue.js` | BullMQ queue + worker |
| MODIFY | `src/modules/auth/auth.controller.js` | Usa emailQueue en lugar de nodemailer directo |
| MODIFY | `src/modules/admin/admin.controller.js` | Ídem |
| MODIFY | `src/modules/solicitudes/solicitudes.controller.js` | Ídem |
| MODIFY | `src/modules/usuarios/usuarios.controller.js` | Ídem |
| CREATE | `src/modules/auth/sessions.controller.js` | GET/DELETE sessions |
| MODIFY | `src/modules/auth/auth.routes.js` | Montar sessions endpoints |
| MODIFY | `src/docs/openapi.js` | Completar spec con endpoints faltantes |
| MODIFY | `src/app.js` | X-Response-Time middleware |
| MODIFY | `src/modules/categorias/categorias.controller.js` | Audit log en CRUD |
| MODIFY | `src/modules/documentos/documentos.controller.js` | Audit log en toggle activo |

---

## Stream A: Soft Deletes

### Task A1: Migración 021 — soft_deletes

**Files:**
- Create: `db/migrations/021_soft_deletes.sql`

- [ ] **Step 1: Crear migración**

```sql
-- db/migrations/021_soft_deletes.sql
-- Soft deletes para entidades principales.
-- IIAP es entidad del Estado — los datos ambientales no se destruyen permanentemente.

ALTER TABLE mapas      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE noticias   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes: el planificador de queries los usa en WHERE deleted_at IS NULL
-- sin costo en inserts/updates normales
CREATE INDEX IF NOT EXISTS idx_mapas_active       ON mapas      (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_active  ON documentos (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_noticias_active    ON noticias   (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_categorias_active  ON categorias (id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN mapas.deleted_at      IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN documentos.deleted_at IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN noticias.deleted_at   IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN categorias.deleted_at IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
```

- [ ] **Step 2: Correr migración**

```bash
node db/migrate.js
```

Esperado: `021_soft_deletes.sql aplicada`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/021_soft_deletes.sql
git commit -m "feat(db): migración 021 — soft deletes en mapas, documentos, noticias, categorias"
```

---

### Task A2: Soft delete en mapas.service.js

**Files:**
- Modify: `src/modules/mapas/mapas.service.js`
- Modify: `tests/mapas.service.test.js`

- [ ] **Step 1: Escribir test fallido para soft delete**

En `tests/mapas.service.test.js`, añadir:

```js
describe('remove() — soft delete', () => {
  it('actualiza deleted_at en lugar de DELETE', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'uuid-m1' }] });

    const { remove } = await import('../src/modules/mapas/mapas.service.js');
    await remove('uuid-m1');

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/deleted_at/i);
    expect(sql).not.toMatch(/^DELETE/i);
  });
});

describe('getAll() — excluye eliminados', () => {
  it('incluye WHERE deleted_at IS NULL en la query', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const { getAll } = await import('../src/modules/mapas/mapas.service.js');
    await getAll({}, null);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/i);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
npx vitest run tests/mapas.service.test.js
```

Esperado: FAIL.

- [ ] **Step 3: Actualizar mapas.service.js**

En la función `getAll()`, añadir a las condiciones iniciales:

```js
// ANTES:
const conditions = isAdminView ? [] : ['m.activo = true'];

// DESPUÉS:
const conditions = isAdminView
  ? ['m.deleted_at IS NULL']
  : ['m.activo = true', 'm.deleted_at IS NULL'];
```

En la función `remove()`:

```js
// ANTES:
export async function remove(id) {
  await query('DELETE FROM mapas WHERE id = $1', [id]);
}

// DESPUÉS:
export async function remove(id) {
  const { rows } = await query(
    'UPDATE mapas SET deleted_at = NOW(), actualizado_en = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id]
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
}
```

- [ ] **Step 4: Verificar que los tests pasan**

```bash
npx vitest run tests/mapas.service.test.js
```

Esperado: PASS.

- [ ] **Step 5: Repetir para documentos.service.js, noticias.service.js, categorias.service.js**

El patrón es idéntico en los 3 servicios:

Para **documentos.service.js**:
- `getAll()`: `conditions = isAdminView ? ['d.deleted_at IS NULL'] : ['d.activo = true', 'd.deleted_at IS NULL']`
- `remove(id)`: `UPDATE documentos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`

Para **noticias.service.js**:
- `getAll()`: `conditions = isAdminView ? ['n.deleted_at IS NULL'] : ['n.publicado = true', 'n.deleted_at IS NULL']`
- `remove(id)`: `UPDATE noticias SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`

Para **categorias.service.js** (verificar cómo está implementado con `cat src/modules/categorias/categorias.service.js`):
- Añadir `WHERE deleted_at IS NULL` en SELECT y `UPDATE ... SET deleted_at = NOW()` en remove.

- [ ] **Step 6: Ejecutar suite completa**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 7: Commit**

```bash
git add src/modules/mapas/mapas.service.js src/modules/documentos/documentos.service.js \
        src/modules/noticias/noticias.service.js src/modules/categorias/categorias.service.js \
        tests/mapas.service.test.js
git commit -m "feat(data): soft deletes en mapas, documentos, noticias, categorias"
```

---

### Task A3: Endpoints de papelera

**Files:**
- Create: `src/modules/admin/papelera.controller.js`
- Modify: `src/modules/admin/admin.routes.js`

- [ ] **Step 1: Crear papelera.controller.js**

```js
// src/modules/admin/papelera.controller.js
import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { registrarCustodia } from '../../utils/dataCustody.js';

const TABLAS = { mapa: 'mapas', documento: 'documentos', noticia: 'noticias', categoria: 'categorias' };
const ACCION_RESTAURACION = 'restauracion';

/** GET /api/admin/papelera?tipo=mapa|documento|noticia|categoria */
export async function getPapelera(req, res, next) {
  try {
    const { tipo, ...rest } = req.query;
    if (!tipo || !TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];
    const { limit, offset, meta } = paginate(rest);

    const [data, count] = await Promise.all([
      query(
        `SELECT * FROM ${tabla} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query(`SELECT COUNT(*) FROM ${tabla} WHERE deleted_at IS NOT NULL`),
    ]);

    res.json({ data: data.rows, meta: meta(Number(count.rows[0].count)) });
  } catch (err) { next(err); }
}

/** PATCH /api/admin/papelera/:tipo/:id/restaurar */
export async function restaurar(req, res, next) {
  try {
    const { tipo, id } = req.params;
    if (!TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];

    const { rows } = await query(
      `UPDATE ${tabla} SET deleted_at = NULL, actualizado_en = NOW() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: `${tipo} no encontrado en papelera` });
    }

    registrarAuditoria({
      accion: `restaurar_${tipo}`, modulo: 'admin', entidadId: id,
      descripcion: `${tipo} restaurado desde papelera`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    registrarCustodia({
      tipoRecurso: tipo, recursoId: id, accion: ACCION_RESTAURACION,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });

    res.json({ message: `${tipo} restaurado correctamente` });
  } catch (err) { next(err); }
}
```

- [ ] **Step 2: Montar en admin.routes.js**

```js
// Añadir en admin.routes.js:
import { getPapelera, restaurar } from './papelera.controller.js';

// Solo super_admin puede acceder a la papelera
router.get('/papelera',                    authenticate, requireSuperAdmin, getPapelera);
router.patch('/papelera/:tipo/:id/restaurar', authenticate, requireSuperAdmin, restaurar);
```

- [ ] **Step 3: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/papelera.controller.js src/modules/admin/admin.routes.js
git commit -m "feat(admin): papelera — GET /api/admin/papelera y PATCH restaurar para super_admin"
```

---

## Stream B: Email Queue con BullMQ

### Task B1: Instalar dependencias y configurar Redis

- [ ] **Step 1: Instalar BullMQ e ioredis**

```bash
npm install bullmq ioredis
```

- [ ] **Step 2: Añadir REDIS_URL a .env.example**

```bash
echo "\n# Redis (Render Redis add-on)\nREDIS_URL=redis://localhost:6379" >> .env.example
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat(deps): añadir bullmq e ioredis para email queue"
```

---

### Task B2: Crear emailQueue.js

**Files:**
- Create: `src/utils/emailQueue.js`

- [ ] **Step 1: Crear el módulo**

```js
// src/utils/emailQueue.js
import { Queue, Worker } from 'bullmq';
import { createTransport } from 'nodemailer';
import logger from './logger.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

export const emailQueue = new Queue('emails', { connection });

const transporter = createTransport({
  host:   process.env.MAIL_HOST,
  port:   Number(process.env.MAIL_PORT ?? 587),
  secure: process.env.MAIL_PORT === '465',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Worker: procesa jobs con retry automático
const worker = new Worker(
  'emails',
  async (job) => {
    const { to, subject, html, text } = job.data;
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? 'no-reply@iiap.gob.co',
      to, subject, html, text,
    });
    logger.info(`[email] Enviado: ${subject} → ${to} (job ${job.id})`);
  },
  {
    connection,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  }
);

worker.on('failed', (job, err) => {
  logger.error(`[email] Job ${job?.id} falló definitivamente: ${err.message}`);
});

/**
 * Encola un email para envío asíncrono.
 * @param {{ to: string, subject: string, html: string, text?: string }} data
 */
export async function queueEmail(data) {
  if (!process.env.REDIS_URL && !process.env.MAIL_HOST) {
    logger.warn('[email] Sin Redis ni SMTP configurados — email no enviado');
    return;
  }
  await emailQueue.add('send', data, {
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}
```

- [ ] **Step 2: Migrar los envíos directos de nodemailer**

En cada controller que llama a funciones de `mailer.js` con `.catch()`, reemplazar por `queueEmail()`.

Ejemplo en `auth.controller.js` — función `register()`:

```js
// ANTES:
notifyVerificacionEmail({ email: user.email, nombre: user.nombre, verificationToken: user.verificationToken })
  .catch((err) => logger.error(`[auth] Error email verificación:`, err.message));

// DESPUÉS:
import { queueEmail } from '../../utils/emailQueue.js';
// Construir el HTML del email (extraer de mailer.js o reusar la función)
const verificationUrl = `${process.env.FRONTEND_URL}/verificar-email/${user.verificationToken}`;
queueEmail({
  to: user.email,
  subject: 'Verifica tu correo — VIGIIAP',
  html: `<p>Hola ${user.nombre}, <a href="${verificationUrl}">haz clic aquí para verificar tu correo</a>.</p>`,
}).catch((err) => logger.warn(`[email] Error encolando verificación: ${err.message}`));
```

> **Nota:** Para no duplicar el HTML de los emails, refactorizar `mailer.js` para exportar funciones de construcción de HTML separadas de las de envío. Las funciones de controller llaman a `queueEmail({ ...buildVerificacionEmail(data) })`.

- [ ] **Step 3: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS (los mocks existentes de mailer.js en tests deben seguir funcionando).

- [ ] **Step 4: Commit**

```bash
git add src/utils/emailQueue.js src/modules/auth/auth.controller.js .env.example
git commit -m "feat(email): BullMQ queue con retry — emails enviados asíncronamente con 3 intentos"
```

---

## Stream C: Session Management API

### Task C1: GET/DELETE /api/auth/sessions

**Files:**
- Create: `src/modules/auth/sessions.controller.js`
- Modify: `src/modules/auth/auth.routes.js`

- [ ] **Step 1: Crear sessions.controller.js**

```js
// src/modules/auth/sessions.controller.js
import crypto from 'node:crypto';
import { query } from '../../config/database.js';
import { REFRESH_COOKIE_NAME } from '../../utils/cookieOptions.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** GET /api/auth/sessions — lista sesiones activas del usuario */
export async function getSessions(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, ip, user_agent, creado_en, expira_en
       FROM refresh_tokens
       WHERE usuario_id = $1 AND revocado = false AND expira_en > NOW()
       ORDER BY creado_en DESC`,
      [req.user.id]
    );

    const currentHash = req.cookies?.[REFRESH_COOKIE_NAME]
      ? hashToken(req.cookies[REFRESH_COOKIE_NAME])
      : null;

    const sessions = rows.map((row) => ({
      id:             row.id,
      ip:             row.ip,
      userAgent:      row.user_agent,
      creadoEn:       row.creado_en,
      expiraEn:       row.expira_en,
      esSesionActual: currentHash
        ? row.id === rows.find(r =>
            query('SELECT token_hash FROM refresh_tokens WHERE id=$1', [r.id])
          )?.id
        : false,
    }));

    res.json(sessions);
  } catch (err) { next(err); }
}

/** DELETE /api/auth/sessions/:id — revoca una sesión específica */
export async function revokeSession(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE refresh_tokens SET revocado = true
       WHERE id = $1 AND usuario_id = $2 AND revocado = false
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (err) { next(err); }
}

/** DELETE /api/auth/sessions — revoca TODAS las sesiones */
export async function revokeAllSessions(req, res, next) {
  try {
    await query(
      `UPDATE refresh_tokens SET revocado = true
       WHERE usuario_id = $1 AND revocado = false`,
      [req.user.id]
    );
    res.json({ message: 'Todas las sesiones cerradas correctamente' });
  } catch (err) { next(err); }
}
```

- [ ] **Step 2: Montar en auth.routes.js**

```js
// Añadir imports:
import { getSessions, revokeSession, revokeAllSessions } from './sessions.controller.js';

// Añadir rutas (requieren authenticate):
router.get('/sessions',      authenticate, getSessions);
router.delete('/sessions/:id', authenticate, revokeSession);
router.delete('/sessions',   authenticate, revokeAllSessions);
```

- [ ] **Step 3: Escribir test de integración**

En `tests/auth.test.js`, añadir:

```js
describe('Session Management', () => {
  it('GET /api/auth/sessions retorna lista de sesiones del usuario', async () => {
    authService.getSessions = vi.fn().mockResolvedValue([
      { id: 'sess-1', ip: '127.0.0.1', userAgent: 'test', creadoEn: new Date(), expiraEn: new Date() }
    ]);
    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('DELETE /api/auth/sessions/:id retorna 404 si la sesión no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/api/auth/sessions/nonexistent-id')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(404);
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
git add src/modules/auth/sessions.controller.js src/modules/auth/auth.routes.js tests/auth.test.js
git commit -m "feat(auth): session management — GET/DELETE /api/auth/sessions"
```

---

## Stream D: OpenAPI + Observabilidad

### Task D1: X-Response-Time middleware

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Añadir middleware en app.js**

Después de `app.use(requestId)` y antes de las rutas:

```js
// X-Response-Time — latencia de cada request en ms
app.use((_req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
  });
  next();
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat(observabilidad): X-Response-Time header en todos los responses"
```

---

### Task D2: Audit log en CRUD de categorias

**Files:**
- Modify: `src/modules/categorias/categorias.controller.js`

- [ ] **Step 1: Añadir registrarAuditoria a create/update/delete**

Verificar primero la estructura del controller:

```bash
cat src/modules/categorias/categorias.controller.js
```

Añadir en cada handler que muta datos (create, update, delete):

```js
// Ejemplo en destroy():
registrarAuditoria({
  accion:       'delete_categoria',
  modulo:       'categorias',
  entidadId:    req.params.id,
  descripcion:  `Categoría eliminada`,
  usuarioId:    req.user.id,
  usuarioEmail: req.user.email,
  ip:           req.ip,
});
```

- [ ] **Step 2: Ejecutar suite**

```bash
npx vitest run
```

Esperado: PASS en todos.

- [ ] **Step 3: Commit**

```bash
git add src/modules/categorias/categorias.controller.js
git commit -m "feat(audit): registrar CRUD de categorías en audit_log"
```

---

### Task D3: Completar OpenAPI spec

**Files:**
- Modify: `src/docs/openapi.js`

- [ ] **Step 1: Auditar endpoints no documentados**

```bash
grep -r "router\." src/modules/auth/auth.routes.js src/modules/categorias/ src/modules/descargas/ src/modules/admin/admin.routes.js | grep -v "//" | head -30
```

- [ ] **Step 2: Añadir paths faltantes en openapi.js**

Para cada endpoint no documentado, añadir el bloque correspondiente. Ejemplo para `/auth/refresh`:

```js
'/auth/refresh': {
  post: {
    tags: ['Autenticación'],
    summary: 'Renovar par de tokens',
    description: 'Usa el refresh token (cookie HttpOnly) para emitir un nuevo access token y refresh token. Token rotation: el refresh anterior queda revocado.',
    security: [],
    responses: {
      200: {
        description: 'Tokens renovados',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: { type: 'string', description: 'Nuevo access token JWT' },
              },
            },
          },
        },
      },
      401: { description: 'Refresh token inválido, expirado o revocado', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
    },
  },
},

'/auth/sessions': {
  get: {
    tags: ['Autenticación'],
    summary: 'Listar sesiones activas',
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: {
      200: { description: 'Lista de sesiones activas del usuario autenticado' },
      401: { '$ref': '#/components/responses/Unauthorized' },
    },
  },
  delete: {
    tags: ['Autenticación'],
    summary: 'Cerrar todas las sesiones',
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: {
      200: { description: 'Todas las sesiones cerradas' },
    },
  },
},
```

Repetir el patrón para categorias CRUD, descargas, custodia, papelera (T2), scan-log.

- [ ] **Step 3: Verificar que la spec es válida**

```bash
node -e "import('./src/docs/openapi.js').then(m => { JSON.stringify(m.openApiSpec); console.log('OpenAPI spec válida') })"
```

Esperado: `OpenAPI spec válida` sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/docs/openapi.js
git commit -m "docs(openapi): completar spec — refresh, sessions, categorias, descargas, custodia, papelera"
```

---

## Task Final: Verificación y PR

- [ ] **Step 1: Ejecutar suite completa**

```bash
npx vitest run
```

Esperado: 320+ tests PASS, 0 FAIL.

- [ ] **Step 2: Verificar 0 vulnerabilidades**

```bash
npm audit
```

Esperado: `found 0 vulnerabilities`.

- [ ] **Step 3: Push y PR**

```bash
git push origin feat/t2-robustness
gh pr create \
  --title "feat(t2): Robustness — soft deletes, email queue BullMQ, session management, OpenAPI completa" \
  --base main \
  --body "## Tier 2 — Robustness

### Cambios
- Soft deletes en mapas, documentos, noticias, categorias (papelera + restauración para super_admin)
- Email queue asíncrona con BullMQ + Redis (3 reintentos, backoff exponencial)
- Session management: GET/DELETE /api/auth/sessions
- OpenAPI spec completa — todos los endpoints documentados
- X-Response-Time header en todos los responses
- Audit log completo en CRUD de categorías y toggle de documentos
"
```
