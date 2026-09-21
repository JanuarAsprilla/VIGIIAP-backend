# VIGIIAP-backend

API REST del sistema VIGIIAP — gestión de mapas, documentos, geovisores y solicitudes de acceso geoespacial para el [IIAP](https://www.iiap.org.co), con control de roles (RBAC) granular por módulo, custodia de datos, auditoría de seguridad y protección de archivos.

Consumida por el frontend [VIGIIAP](https://github.com/JanuarAsprilla/VIGIIAP) (React), un proyecto independiente.

## Stack
- **Runtime:** Node.js 20+ con ES Modules (`"type": "module"`)
- **Framework:** Express 4
- **DB:** PostgreSQL + PostGIS vía `pg` (Pool) — **autohospedado** en Docker (no Supabase)
- **Storage:** compatible S3 — Cloudflare R2 o **MinIO autohospedado** (`S3_ENDPOINT` elige cuál; ver `.env.example`)
- **Auth:** JWT (jsonwebtoken) + bcryptjs + 2FA (TOTP vía `otplib`) + login social (Google/Microsoft OAuth)
- **Validación:** Zod (`*.schema.js` por módulo)
- **Logs:** Winston
- **Tests:** Vitest (unit + integración)
- **Deploy:** Docker Compose en un servidor propio (VPS) — imagen construida y publicada por GitHub Actions a GHCR, desplegada por SSH. No usa Render ni ningún PaaS.

## Estructura
```
src/
├── app.js                  # Express setup + rutas montadas bajo /api/v1 (alias /api)
├── config/
│   ├── database.js         # Pool pg + helpers query/getClient
│   ├── dynamicConfig.js    # Config editable en caliente desde el panel admin
│   └── r2.js                # Cliente S3 (R2 o MinIO según S3_ENDPOINT)
├── middlewares/
│   ├── auth.js              # authenticate + authorize(...roles) — super_admin auto-pasa
│   ├── requireModulo.js     # RBAC granular: exige permiso ver/editar sobre un módulo puntual
│   ├── errorHandler.js      # Global error handler
│   ├── fileGuard.js         # Magic-byte malware detection + sha256
│   ├── geoValidator.js      # CRS / bbox / escala validation (ISO 19115)
│   ├── maintenanceMode.js   # Modo mantenimiento activable desde config
│   ├── rateLimiter.js       # rateLimiter general + limiters dedicados (auth, upload, download, tiles WMS)
│   └── upload.js            # Multer → fileGuard → almacenamiento S3-compatible
├── modules/
│   ├── admin/                # Dashboard, usuarios, auditoría, custodia, exportación, config, permisos por módulo
│   ├── auth/                  # login, registro, /me, 2FA, sesiones activas, OAuth, contraseña expirada
│   ├── categorias/             # Catálogo de categorías compartido entre mapas/documentos/geovisores
│   ├── descargas/               # Tracking de descargas
│   ├── documentos/               # CRUD documentos
│   ├── geovisores/                 # Geovisores + conexiones GeoServer (proxy WMS/WFS con guard SSRF)
│   ├── herramientas/                 # Calculadoras y paneles de análisis
│   ├── mapas/                          # CRUD mapas + metadatos técnicos (EPSG/escala/fuente/bbox)
│   ├── notificaciones/                   # Notificaciones in-app + preferencias por usuario
│   ├── oauth/                              # Login social (Google, Microsoft)
│   ├── solicitudes/                          # Gestión de solicitudes de acceso
│   └── usuarios/                                # Perfil, cambio de contraseña, roles
└── utils/
    ├── auditLog.js          # audit_log — acciones de seguridad y administrativas
    ├── dataCustody.js       # geo_custodia + descarga_log + file_scan_log
    ├── ssrfGuard.js          # Bloquea que una conexión GeoServer apunte a red interna/privada
    ├── logger.js             # Winston
    ├── mailer.js              # nodemailer SMTP
    ├── passwordPolicy.js      # Política de contraseñas
    ├── rateLimitAutoScaler.js  # Ajuste dinámico de límites de tráfico
    └── slugify.js               # Slugs en español
db/
├── migrate.js              # Runner de migraciones (corre solo al arrancar el contenedor)
└── migrations/              # Migraciones aplicadas
docker-compose.yml          # Stack self-hosted: app + PostgreSQL/PostGIS + MinIO
server.js                   # Entry point
scripts/
├── create-admin.js         # Seed inicial admin_sig (requiere ADMIN_SEED_PASSWORD)
└── create-superadmin.js    # Crea o promueve a super_admin
```

## RBAC — Roles y jerarquía
`super_admin` > `admin_sig` > `investigador` = `tecnico` = `institucional` > `publico` = `visitante`

| Rol | Panel admin | Subir docs | Ver solicitudes propias | Editar perfil |
|-----|------------|-----------|------------------------|---------------|
| super_admin | Completo (invisible para admin_sig) | ✓ | ✓ | ✓ |
| admin_sig | Según permisos por módulo (ver abajo) | ✓ | ✓ | ✓ |
| investigador/tecnico/institucional | ✗ | ✗ | ✓ | ✓ |
| publico/visitante | ✗ | ✗ | ✗ | ✗ (403) |

**Reglas críticas de RBAC:**
- `super_admin` es completamente invisible para `admin_sig` en listados y en el registro de actividad — con la excepción de que **otro `super_admin` sí ve la actividad de sus pares** (accountability entre iguales, no oculto para todos).
- Cada `admin_sig` tiene permisos **granulares por módulo** (`ver`/`editar`, tabla `admin_permisos_modulo`), asignados por un `super_admin` — no es todo-o-nada. Ver `requireModulo()` middleware y `admin/modulos.service.js`.
- Solo `super_admin` puede crear/modificar/eliminar otros `admin_sig`.
- `publico` y `visitante` no pueden editar perfil ni cambiar contraseña (403).

## Módulos y rutas principales
Todas bajo `/api/v1` (alias de transición `/api`, se retira en v2).

| Prefijo | Módulo |
|---|---|
| `/auth`, `/auth/oauth` | Login, registro, `/me`, 2FA, sesiones, login social |
| `/mapas` | CRUD de mapas + metadatos técnicos |
| `/documentos` | CRUD de documentos |
| `/geovisores` | Geovisores públicos, capas, proxy WMS/leyenda |
| `/admin/conexiones-geoserver` | Conexiones GeoServer (solo admin) |
| `/categorias` | Catálogo de categorías |
| `/herramientas` | Calculadoras y paneles de análisis |
| `/descargar` | Descarga de archivos (con tracking) |
| `/solicitudes` | Solicitudes de acceso |
| `/usuarios` | Perfil y gestión de cuenta propia |
| `/notificaciones` | Notificaciones in-app |
| `/admin` | Dashboard, usuarios, auditoría (`/admin/audit`), config, exportaciones |
| `/public` | Endpoints públicos sin autenticación (config pública, etc.) |

Ver `/api/docs` (Swagger, solo en entornos no productivos) para el detalle completo endpoint por endpoint.

## Seguridad

**Archivos subidos** (`src/middlewares/fileGuard.js`) — 4 pasos:
1. Lista negra de ejecutables (MZ/ELF/Java/ZIP/gzip/bzip2/RAR/7z/shebang/OLE)
2. Whitelist de extensiones (pdf/jpg/jpeg/png/webp/gif)
3. Cross-check extensión ↔ MIME declarado por cliente
4. Magic bytes del tipo declarado (positive match)

**SSRF en el proxy GeoServer** (`src/utils/ssrfGuard.js`) — antes de reenviar una petición WMS/WFS, resuelve el hostname de la conexión GeoServer configurada y bloquea si apunta a una red privada/reservada (RFC 1918, loopback, metadata de nube), tanto IPv4 como IPv6. Revalida en cada uso (no solo al guardar la conexión), con caché corto para no repetir la resolución DNS en cada tile.

**Cadena de custodia geoespacial** (`src/utils/dataCustody.js`) — 3 tablas:
- `geo_custodia` — ciclo de vida (ingreso/actualización/publicación/despublicación/eliminación)
- `descarga_log` — quién descargó qué y cuándo
- `file_scan_log` — resultado del escaneo de cada archivo subido

**Auditoría** (`src/utils/auditLog.js`, tabla `audit_log`) — registra acciones administrativas y eventos de seguridad de auth: login/logout, registro, verificación de email, activar/desactivar 2FA, solicitud y reseteo de contraseña, revocar sesiones, cambios de configuración crítica. Consultable desde el panel admin (`/admin/audit`) con filtros por módulo, acción, rango de fechas y búsqueda de texto.

**2FA y sesiones**
- TOTP vía `otplib` — `POST /api/auth/2fa/setup`, `/2fa/confirm`, `/2fa/disable`
- Sesiones activas por dispositivo: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` o `/sessions` (todas)
- Contraseña expirada: flag `password_expires_at` → redirige al flujo `/change-expired-password`

**Rate limiting** — límites dedicados por tipo de tráfico (`authRateLimiter`, `uploadRateLimiter`, `downloadRateLimiter`, `tileRateLimiter` para tiles WMS/leyenda, excluidos del límite general para no agotarlo con el paneo normal de un mapa), con ajuste automático (`rateLimitAutoScaler.js`).

## Convenciones de desarrollo
1. Patrón por módulo: `routes → controller → service → DB`
2. El controller solo valida (Zod) y llama al service — sin lógica de negocio
3. El service lanza errores con `Object.assign(new Error(...), { status: N })`
4. Siempre usar `query()` de `config/database.js` — nunca `pg` directo
5. Paginación con el helper `paginate()` de `utils/paginate.js`
6. Archivos: subir con `uploadFile()` de `config/r2.js` (S3-compatible, no acoplado a un proveedor)
7. Emails: usar funciones de `utils/mailer.js` — nunca `nodemailer` directo
8. Auditoría: llamar `registrarAuditoria()` en toda acción crítica o evento de seguridad
9. Commits convencionales: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

## Setup inicial

**Opción A — Docker Compose (recomendada, replica el stack de producción):**
```bash
cp .env.example .env   # ver notas en docker-compose.yml para las variables de este stack
docker compose up -d --build
# las migraciones corren solas al arrancar; minio-init crea los buckets antes de que 'app' levante
docker compose exec -e NODE_ENV=development -e ADMIN_SEED_PASSWORD=TuPassword123! app npm run create-admin
```

**Opción B — Node local (requiere Postgres/PostGIS y un storage S3-compatible aparte):**
```bash
cp .env.example .env
npm install
npm run migrate
ADMIN_SEED_PASSWORD=TuPassword123! npm run create-admin
npm run dev            # servidor en puerto 4000
```

## Variables de entorno
Ver `.env.example` — las críticas son `DB_*`, `JWT_SECRET`, `R2_*`/`S3_*`, `MAIL_*`, `FRONTEND_URL`, `CORS_ORIGIN`. Para el script de seed: `ADMIN_SEED_PASSWORD` (y opcionalmente `ADMIN_SEED_EMAIL`).

## Tests
```bash
npm test                  # unit + servicio, Vitest
npm run test:coverage
npm run test:integration  # requiere DB real — ver vitest.integration.config.js
npm run lint
```
