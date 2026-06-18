# VIGIIAP Backend — Elevación a Nivel de Producción de Altísimo Nivel

**Fecha:** 2026-06-18
**Fase del proyecto:** A (pre-lanzamiento)
**Escala objetivo:** Media — cientos a miles de usuarios (investigadores, técnicos, instituciones, público general)
**Stack:** Node.js 20+ ES Modules, Express 4, PostgreSQL + PostGIS, Cloudflare R2, Redis (T2+)
**Entidad:** IIAP Colombia — sistema de información geoespacial gubernamental

---

## Contexto

El backend ya cuenta con una base sólida:
- JWT + refresh tokens con rotación y detección de robo
- Token blacklist, account lockout, rate limiting
- Helmet hardening, CORS estricto, file guard (magic bytes)
- Audit log, cadena de custodia geoespacial, validación EPSG/bbox
- Graceful shutdown, OpenAPI docs, 281 tests, 0 CVEs

Este documento especifica los 3 tiers que llevan el sistema al nivel de producción de altísimo nivel.

---

## Enfoque: Elevación en 3 Tiers

Cada tier es un PR independiente. Los tiers se construyen secuencialmente (T2 sobre T1, T3 sobre T2). Dentro de cada tier, los cambios independientes se implementan con agentes paralelos.

---

## Tier 1 — Foundation (PR #17)

**Objetivo:** Cerrar todos los gaps existentes. Base sólida sobre la que T2 y T3 construyen.

### 1.1 Seguridad de Sesiones

**Problema:** Cambiar contraseña no invalida sesiones activas. Si alguien robó un refresh token y el usuario cambia su contraseña, el atacante mantiene acceso hasta que el refresh token expire (30 días).

**Implementación:**

`usuarios.service.js` — `updatePassword()`:
```js
await revokeAllRefreshTokens(userId);
// el access token actual se blacklistea en el controller tras la llamada
```

`usuarios.controller.js` — `changePassword()`:
```js
await userService.updatePassword(req.user.id, currentPassword, newPassword);
// blacklistear access token actual
const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.slice(7);
if (token) await revokeToken(token, req.user.exp ?? Math.floor(Date.now()/1000) + 900);
res.clearCookie(COOKIE_NAME, clearCookieOptions());
res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
```

`auth.service.js` — `resetPassword()`: mismo patrón (revocar todas las sesiones tras reset exitoso).

**Logout de visitante:** `auth.controller.js` — el logout ya blacklistea el JWT. Añadir limpieza de cookie aunque `req.user.id` sea undefined. El log de auditoría usa `req.user.visitanteId`.

### 1.2 Health Check Real

**Problema:** `/health` retorna `ok` aunque la BD esté caída. Render y monitores de uptime creen que la app está sana cuando no lo está.

**Implementación en `app.js`:**
```js
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), db: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});
```

### 1.3 Schemas: Max Lengths Faltantes

Campos que actualmente llegan a la BD sin límite superior:

| Campo | Schema | Max |
|-------|--------|-----|
| `nombre` | `registerSchema` | 150 |
| `institucion` | `registerSchema` | 300 |
| `motivo` | `registerSchema` | 500 |
| `descripcion` | `createSolicitudSchema` | 1000 |
| `email` | todos los schemas con email | 254 (RFC 5321) |
| `nombre` en visitante | controller inline | 100 (ya existe) |

**Archivos:** `auth.schema.js`, `solicitudes.schema.js`

### 1.4 Estandarización de Formato de Respuesta

**Convención:**
- **Errores** (4xx, 5xx): `{ error: string, code?: string }` — ya lo hace `errorHandler.js`
- **Éxito con mensaje** (logout, password change, etc.): `{ message: string }` — correcto
- **Éxito con datos**: objeto directo o `{ data, meta }` para listas paginadas

**Casos a corregir** (usan `{ message }` para errores inline):
- `auth.controller.js` línea 178: `{ message: 'Email requerido' }` → `{ error: 'Email requerido' }`
- `admin.controller.js` línea 100: `{ message: 'nombre, email y rol son obligatorios' }` → `{ error: ... }`

### 1.5 X-Request-ID — Correlation ID

**Problema:** Sin ID de request trazable, correlacionar un error en Render con su log de Winston es imposible.

**Implementación:** Middleware nuevo `src/middlewares/requestId.js`:
```js
import { randomUUID } from 'node:crypto';
export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] ?? randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
```

Se registra en `app.js` como primer middleware después de `helmet`. Winston recibe el `requestId` en cada log de Morgan.

### 1.6 last_login_at

**Problema:** No hay registro de cuándo fue el último acceso de un usuario. Útil para detectar cuentas inactivas y para dashboards de seguridad.

**Migración `020_last_login.sql`:**
```sql
ALTER TABLE usuarios ADD COLUMN last_login_at TIMESTAMPTZ;
CREATE INDEX idx_usuarios_last_login ON usuarios(last_login_at);
```

**`auth.service.js` — `login()`:** Añadir al UPDATE de reset de intentos fallidos:
```sql
UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL, last_login_at=NOW() WHERE id=$1
```

**Expuesto en:** `GET /api/auth/me` y en `GET /api/admin/usuarios`.

### 1.7 Validación de ENV Completa

**`server.js` — `validateEnv()`:**
Añadir grupo de email como warning (no fatal — dev puede correr sin email):
```js
const emailVars = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM'];
const missingEmail = emailVars.filter(k => !process.env[k]);
if (missingEmail.length) {
  logger.warn(`[startup] Email no configurado (${missingEmail.join(', ')}) — notificaciones desactivadas`);
}
```

### Tests T1

- `auth.service.test.js`: `updatePassword` invoca `revokeAllRefreshTokens`
- `auth.service.test.js`: `resetPassword` invoca `revokeAllRefreshTokens`
- `app.test.js`: `/health` retorna 503 con `{ status: 'degraded' }` cuando DB falla
- `auth.schema.test.js`: campos con longitud > max son rechazados con 422
- `requestId.test.js`: header `X-Request-Id` presente en todos los responses
- `auth.service.test.js`: `login` actualiza `last_login_at`

**Archivos modificados T1:** ~12 archivos, 1 migración, 0 dependencias nuevas, ~25 tests nuevos.

---

## Tier 2 — Robustness (PR #18)

**Objetivo:** Capacidades que un sistema de producción gubernamental debe tener. Construye sobre T1.

### 2.1 Soft Deletes

**Por qué es crítico:** IIAP es entidad del Estado colombiano. Destruir permanentemente un mapa geoespacial o documento ambiental puede tener implicaciones legales y de auditoría.

**Migración `021_soft_deletes.sql`:**
```sql
ALTER TABLE mapas       ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE documentos  ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE noticias    ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE categorias  ADD COLUMN deleted_at TIMESTAMPTZ;

-- Partial indexes: costo cero en queries normales
CREATE INDEX idx_mapas_active       ON mapas(id)       WHERE deleted_at IS NULL;
CREATE INDEX idx_documentos_active  ON documentos(id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_noticias_active    ON noticias(id)    WHERE deleted_at IS NULL;
CREATE INDEX idx_categorias_active  ON categorias(id)  WHERE deleted_at IS NULL;
```

**Cambios en services:**
- Todos los `SELECT` de listado: `WHERE deleted_at IS NULL`
- `remove()` en mapas/documentos/noticias/categorias: `UPDATE SET deleted_at = NOW()` en lugar de `DELETE`
- La cadena de custodia (`registrarCustodia`) ya registra la eliminación → intacta

**Endpoints nuevos (solo `super_admin`):**
```
GET   /api/admin/papelera?tipo=mapa|documento|noticia|categoria&page=&limit=
PATCH /api/admin/papelera/:tipo/:id/restaurar
```

La restauración hace `UPDATE SET deleted_at = NULL` y registra en custodia + audit log.

### 2.2 Email Queue con Retry (BullMQ + Redis)

**Problema:** Si el SMTP falla, el email se pierde silenciosamente. Registro, recuperación de contraseña y notificaciones a admins son flujos críticos.

**Nueva dependencia:** `bullmq`, `ioredis`

**Archivo nuevo `src/utils/emailQueue.js`:**
```js
import { Queue, Worker } from 'bullmq';
// Jobs: verificacion-email, recuperar-password, notificacion-admin,
//       cambio-estado-solicitud, activacion-cuenta, creacion-por-admin
```

**Configuración de retry:**
- 3 intentos
- Backoff exponencial: 2s → 4s → 8s
- Dead letter: job fallido 3x → log ERROR + (futuro: alerta Slack/email a super_admin)

**Migración de controllers:** Todas las llamadas directas a nodemailer se reemplazan por `emailQueue.add(jobType, data)`. El controller responde al cliente inmediatamente sin esperar el envío.

**Worker:** Corre en el mismo proceso Node.js (suficiente para escala media). Para escala alta, se puede extraer a un proceso separado sin cambiar la API.

**Variable de entorno nueva:** `REDIS_URL` (Render Redis add-on).

### 2.3 Session Management API

**Problema:** Un usuario no puede ver ni revocar sus propias sesiones activas. Si sospecha una intrusión, solo puede cambiar la contraseña (lo cual ahora invalida sesiones gracias a T1).

**Endpoints nuevos:**
```
GET    /api/auth/sessions       → lista refresh tokens activos del usuario
DELETE /api/auth/sessions/:id   → revoca un token específico por ID de la tabla
DELETE /api/auth/sessions       → revoca TODAS las sesiones excepto la actual (logout global)
```

**Response de GET /api/auth/sessions:**
```json
[
  {
    "id": "uuid",
    "ip": "190.45.x.x",
    "userAgent": "Chrome/124 macOS",
    "creadoEn": "2026-06-15T10:30:00Z",
    "expiraEn": "2026-07-15T10:30:00Z",
    "esSesionActual": true
  }
]
```

`esSesionActual`: se determina comparando el `REFRESH_COOKIE_NAME` de la request con los `token_hash` del usuario en BD.

### 2.4 OpenAPI Spec Completa

**Endpoints actualmente no documentados:**
- `POST /api/auth/refresh`
- `GET/DELETE /api/auth/sessions` (nuevo T2)
- CRUD `/api/categorias`
- `/api/admin/custodia`, `/api/admin/descargas`, `/api/admin/scan-log`
- `GET /api/descargar/:id`
- `PATCH /api/mapas/:id/activo`
- `GET/PATCH /api/admin/papelera` (nuevo T2)

**Mejoras adicionales:**
- Ejemplos de response en cada operación
- Schemas de error `403`, `422` en todos los endpoints que los pueden lanzar
- Tags organizados por módulo

### 2.5 Observabilidad

**X-Response-Time header:**
Middleware en `app.js` que mide latencia y añade `X-Response-Time: 45ms`. Permite detectar endpoints lentos desde los logs de Render o el frontend.

**Audit log gaps a cerrar:**
- CRUD de categorías (create/update/delete)
- Toggle `activo` en documentos
- Acceso a papelera (T2.1)
- Restauración de elemento eliminado (T2.1)

### Tests T2

- Soft delete: elemento "eliminado" no aparece en listado público ni en slugs, sí en papelera admin
- Restaurar: elemento restaurado vuelve a aparecer en listados
- Email queue: job encolado correctamente, retry tras fallo SMTP (mock)
- Sessions: GET lista solo sesiones del usuario autenticado
- Sessions: DELETE específico invalida ese token, otros siguen válidos
- Sessions: DELETE all invalida todos excepto el actual
- OpenAPI: spec completa parseable sin referencias rotas
- Response time: `X-Response-Time` presente en todos los responses

**Archivos modificados T2:** ~20 archivos, 2 migraciones, 2 deps nuevas (`bullmq`, `ioredis`), ~35 tests nuevos.

---

## Tier 3 — Advanced (PR #19)

**Objetivo:** Capacidades que distinguen un backend de clase mundial. Construye sobre T1+T2.

### 3.1 Autenticación de Dos Factores (TOTP)

**Alcance:** Obligatorio para `super_admin` y `admin_sig`. Opcional para `investigador`/`institucional`.

**Stack:** `otplib` + `qrcode`. Sin SMS — funciona con Google Authenticator, Authy, 1Password.

**Migración `022_two_factor_auth.sql`:**
```sql
ALTER TABLE usuarios
  ADD COLUMN totp_secret       TEXT,
  ADD COLUMN totp_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN totp_backup_codes TEXT[]; -- 8 códigos de emergencia hasheados con bcrypt
```

**Endpoints nuevos:**
```
POST /api/auth/2fa/setup    → genera secret + URL para QR (requiere JWT válido)
POST /api/auth/2fa/verify   → valida código TOTP → activa 2FA → devuelve backup codes
POST /api/auth/2fa/disable  → desactiva 2FA (requiere código TOTP válido)
POST /api/auth/2fa/confirm  → paso 2 del login cuando 2FA está activo
```

**Flujo de login con 2FA:**
```
POST /api/auth/login → credenciales OK, 2FA activo
  → 200 { requiresTwoFactor: true, twoFactorToken: "<jwt 15min, scope='2fa'>" }
POST /api/auth/2fa/confirm { code: "123456" } + cookie twoFactorToken
  → 200 { token, user } — igual que login normal
```

El `twoFactorToken` es un JWT de corta duración con `scope: '2fa'` en el payload. El endpoint `/api/auth/2fa/confirm` verifica que el scope sea correcto antes de proceder.

**Códigos de backup:** 8 códigos alfanuméricos de 10 chars, hasheados con bcrypt, de un solo uso. Al usar uno se elimina del array.

### 3.2 Cache Redis para Endpoints Públicos

**Stack:** El Redis de T2 (BullMQ) se reutiliza para cache. Sin costo adicional de infraestructura.

**Middleware nuevo `src/middlewares/cache.js`:**
```js
export function cacheMiddleware(ttlSeconds) {
  return async (req, res, next) => {
    // Admin views y requests autenticados no se cachean
    if (req.query.admin === 'true' || req.user) return next();
    const key = `cache:${req.path}:${JSON.stringify(req.query)}`;
    const cached = await redis.get(key);
    if (cached) return res.json(JSON.parse(cached));
    // Interceptar res.json para cachear el resultado
    const originalJson = res.json.bind(res);
    res.json = (data) => { redis.setex(key, ttlSeconds, JSON.stringify(data)); return originalJson(data); };
    next();
  };
}
```

**TTLs por endpoint:**

| Endpoint | TTL | Invalidado por |
|----------|-----|----------------|
| `GET /api/mapas` | 120s | create/update/toggle activo |
| `GET /api/mapas/:slug` | 300s | update ese mapa |
| `GET /api/documentos` | 120s | create/update documento |
| `GET /api/noticias` | 120s | create/update noticia |
| `GET /api/categorias` | 600s | cualquier cambio en categorías |

**Invalidación:** Los services llaman `invalidateCache(pattern)` tras mutaciones.

### 3.3 Export CSV / Excel

**Endpoints:**
```
GET /api/admin/export/usuarios?formato=csv|xlsx
GET /api/admin/export/solicitudes?formato=csv|xlsx&desde=&hasta=
GET /api/admin/export/audit?formato=csv|xlsx&desde=&hasta=
GET /api/admin/export/descargas?formato=csv|xlsx
```

**Stack:** `xlsx` (SheetJS community edition — MIT license).

**Seguridad:**
- Campos excluidos en todos los exports: `password_hash`, `totp_secret`, `totp_backup_codes`, `email_verification_token`, `password_reset_token`
- Límite: 10,000 filas por export. Si hay más, responde 400 con instrucciones para usar filtros de fecha
- Cada export se registra en `audit_log`

**Content-Type:**
- CSV: `text/csv; charset=utf-8`
- Excel: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

### 3.4 Rate Limiting por Usuario Autenticado

**Problema:** Rate limiting por IP puede bloquear usuarios legítimos detrás de NAT compartido, y un atacante con muchas IPs puede bypassearlo.

**Implementación:** Reemplazar el key generator del rate limiter global:
```js
keyGenerator: (req) => req.user?.id ?? req.ip,
limit: (req) => req.user ? 500 : 100, // por ventana de 15 min
```

**Upload rate limiter:** Límite adicional por usuario: 10 uploads/hora, independiente de IP.

**Archivo:** `src/middlewares/rateLimiter.js`

### 3.5 Password Expiry Policy

**Alcance:** Solo roles institucionales (`admin_sig`, `investigador`, `tecnico`, `institucional`). `publico` y `visitante` no aplican.

**Migración `023_password_expiry.sql`:**
```sql
ALTER TABLE usuarios ADD COLUMN password_changed_at TIMESTAMPTZ DEFAULT NOW();
```

**Política:** 90 días. Configurable en tabla `configuracion` con clave `passwordExpiryDays` (añadida al schema de T1 1.4).

**Flujo:**
```
POST /api/auth/login → contraseña expirada
  → 200 { passwordExpired: true, expiredToken: "<jwt 15min, scope='password-change'>" }
POST /api/auth/change-expired-password { newPassword } + cookie expiredToken
  → 200 { token, user } — login normal
```

`password_changed_at` se actualiza en: `updatePassword()`, `resetPassword()`, y el nuevo endpoint.

### 3.6 Batch Operations para Admin

**Problema:** Activar/desactivar usuarios de uno en uno es ineficiente para un sistema nuevo con muchos registros pendientes.

**Endpoint:**
```
PATCH /api/admin/usuarios/batch
Body: { ids: ["uuid1", "uuid2"], accion: "activar"|"desactivar"|"cambiar-rol", rol?: string }
```

**Restricciones:**
- Máximo 50 IDs por operación (retorna 400 si se superan)
- No se puede operar sobre cuentas `super_admin` (retorna 403 si alguna ID lo es)
- Toda operación batch genera una entrada en `audit_log` con el array completo de IDs afectados y los resultados

### Tests T3

- 2FA setup → QR generado → código válido activa 2FA
- 2FA login: credenciales válidas + código correcto → sesión completa
- 2FA login: credenciales válidas + código incorrecto → 401
- Backup code: uno de los 8 funciona, el mismo no puede usarse dos veces
- Cache: segundo request mismo endpoint usa cache (mock Redis)
- Cache: mutación invalida cache, siguiente request va a BD
- Export CSV: columnas correctas, sin `password_hash` en output
- Export Excel: archivo parseable, límite 10,000 filas
- Rate limit por usuario: usuario A no afecta límite de usuario B en misma IP
- Password expiry: login con contraseña expirada retorna flag + token de scope correcto
- Batch: 51 IDs → 400; super_admin en lista → 403; operación válida → todos actualizados

**Archivos modificados T3:** ~25 archivos, 2 migraciones, 3 deps nuevas (`otplib`, `qrcode`, `xlsx`), ~45 tests nuevos.

---

## Resumen de Impacto

| Tier | PR | Migraciones | Deps nuevas | Tests nuevos | Estado final |
|------|-----|-------------|-------------|--------------|--------------|
| T1 Foundation | #17 | 020 | 0 | ~25 | 306 tests |
| T2 Robustness | #18 | 021 | bullmq, ioredis | ~35 | 341 tests |
| T3 Advanced | #19 | 022, 023 | otplib, qrcode, xlsx | ~45 | 386 tests |

**Al finalizar los 3 tiers:**
- ~386 tests (281 actuales + 105 nuevos)
- 0 CVEs (npm audit)
- 5 migraciones nuevas (020–023)
- 5 dependencias nuevas
- Cobertura de todos los gaps identificados
- Capacidades avanzadas (2FA, cache, export, batch operations)

---

## Orden de Implementación Recomendado

### Tier 1 (agentes en paralelo)
- **Agente A:** 1.1 (sesiones) + 1.7 (ENV validation)
- **Agente B:** 1.2 (health check) + 1.5 (X-Request-ID) + 1.6 (last_login_at + migración 020)
- **Agente C:** 1.3 (schemas max lengths) + 1.4 (error format)
- **Merge → tests → PR #17**

### Tier 2 (agentes en paralelo, sobre T1 merged)
- **Agente A:** 2.1 (soft deletes + migración 021)
- **Agente B:** 2.2 (email queue BullMQ)
- **Agente C:** 2.3 (session management) + 2.5 (observabilidad)
- **Agente D:** 2.4 (OpenAPI completo)
- **Merge → tests → PR #18**

### Tier 3 (agentes en paralelo, sobre T2 merged)
- **Agente A:** 3.1 (2FA TOTP + migración 022)
- **Agente B:** 3.2 (cache Redis) + 3.4 (rate limit por usuario)
- **Agente C:** 3.3 (export CSV/Excel)
- **Agente D:** 3.5 (password expiry + migración 023) + 3.6 (batch operations)
- **Merge → tests → PR #19**
