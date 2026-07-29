# VIGIIAP-backend — API REST

## Stack
- **Runtime:** Node.js 20+ con ES Modules (`"type": "module"`)
- **Framework:** Express 4
- **DB:** PostgreSQL + PostGIS vía `pg` (Pool) — Supabase
- **Auth:** JWT (jsonwebtoken) + bcryptjs + 2FA (TOTP via otplib)
- **Validación:** Zod (schemas en `*.schema.js`)
- **Storage:** Cloudflare R2 (compatible S3 — `@aws-sdk/client-s3`)
- **Logs:** Winston
- **Tests:** Vitest (675 tests)
- **Deploy:** Render (Web Service)

## Estructura
```
src/
├── app.js                  # Express setup + rutas montadas
├── config/
│   ├── database.js         # Pool pg + helpers query/getClient
│   └── r2.js               # Cliente S3 para Cloudflare R2
├── middlewares/
│   ├── auth.js             # authenticate + authorize(...roles) — super_admin auto-pasa
│   ├── errorHandler.js     # Global error handler
│   ├── fileGuard.js        # Magic-byte malware detection + sha256
│   ├── geoValidator.js     # CRS / bbox / escala validation (ISO 19115)
│   ├── notFound.js         # 404 handler
│   ├── rateLimiter.js      # rateLimiter + authRateLimiter + uploadRateLimiter + downloadRateLimiter
│   └── upload.js           # Multer → fileGuard → R2 (3-step middleware)
├── modules/
│   ├── admin/              # Dashboard, usuarios, auditoria, custodia, exportación
│   ├── auth/               # login, registro, /me, 2FA, contraseña expirada
│   ├── categorias/         # Catálogo de categorías
│   ├── descargas/          # Tracking de descargas
│   ├── documentos/         # CRUD documentos
│   ├── mapas/              # CRUD mapas
│   ├── solicitudes/        # Gestión solicitudes de acceso
│   └── usuarios/           # Perfil, cambio de contraseña, roles
└── utils/
    ├── auditLog.js          # audit_log table (acciones críticas)
    ├── dataCustody.js       # geo_custodia + descarga_log + file_scan_log
    ├── logger.js            # Winston
    ├── mailer.js            # nodemailer SMTP (Brevo)
    ├── paginate.js          # Helper paginación SQL
    └── slugify.js           # Slugs en español
db/
├── migrate.js              # Runner de migraciones
└── migrations/             # 001–029 migraciones aplicadas
server.js                   # Entry point
scripts/
├── create-admin.js         # Seed inicial admin_sig (requiere ADMIN_SEED_PASSWORD en entorno)
└── create-superadmin.js    # Crea o promueve a super_admin
```

## RBAC — Roles y jerarquía
`super_admin` > `admin_sig` > `investigador` = `tecnico` = `institucional` > `publico` = `visitante`

| Rol | Panel admin | Subir docs | Ver solicitudes propias | Editar perfil |
|-----|------------|-----------|------------------------|---------------|
| super_admin | Completo (invisible para admin_sig) | ✓ | ✓ | ✓ |
| admin_sig | Sí (sin tocar super_admin) | ✓ | ✓ | ✓ |
| investigador/tecnico/institucional | ✗ | ✗ | ✓ | ✓ |
| publico/visitante | ✗ | ✗ | ✗ | ✗ (403) |

**Reglas críticas de RBAC:**
- `super_admin` es completamente invisible para `admin_sig` (no aparece en listados, no puede ser modificado/eliminado)
- Solo `super_admin` puede crear/modificar/eliminar otros `admin_sig`
- `investigador`, `tecnico`, `institucional`, `publico`, `visitante` no tienen acceso al panel admin
- `publico` y `visitante` no pueden editar perfil ni cambiar contraseña (backend retorna 403)
- Solo `admin_sig` puede subir documentos (investigador NO)

## API Endpoints principales
| Método | Ruta | Auth requerida |
|--------|------|----------------|
| POST | /api/auth/login | — |
| POST | /api/auth/registro | — |
| POST | /api/auth/visitante | — |
| GET | /api/auth/me | JWT |
| POST | /api/auth/2fa/confirm | JWT |
| POST | /api/auth/change-expired-password | JWT |
| GET | /api/mapas | — |
| POST | /api/mapas | admin_sig |
| PUT | /api/mapas/:id | admin_sig |
| DELETE | /api/mapas/:id | admin_sig |
| GET | /api/documentos | — |
| POST | /api/documentos | admin_sig |
| DELETE | /api/documentos/:id | admin_sig |
| GET | /api/solicitudes/mis-solicitudes | verificados |
| GET/POST | /api/solicitudes | verificados |
| PATCH | /api/solicitudes/:id/estado | admin_sig |
| GET | /api/usuarios | admin_sig |
| PATCH | /api/usuarios/:id/rol | admin_sig |
| PATCH | /api/usuarios/me | verificados |
| PATCH | /api/usuarios/me/password | verificados |
| GET | /api/admin/usuarios | admin_sig |
| POST | /api/admin/usuarios | admin_sig |
| PATCH | /api/admin/usuarios/:id | admin_sig |
| DELETE | /api/admin/usuarios/:id | admin_sig |
| GET | /api/admin/stats | admin_sig |
| GET | /api/admin/audit | admin_sig |
| GET | /api/admin/custodia | admin_sig |
| GET | /api/admin/export/usuarios | admin_sig |

## Seguridad de archivos
`src/middlewares/fileGuard.js` — validación en 4 pasos:
1. Lista negra de ejecutables (MZ/ELF/Java/ZIP/gzip/bzip2/RAR/7z/shebang/OLE)
2. Whitelist de extensiones (pdf/jpg/jpeg/png/webp/gif)
3. Cross-check extensión ↔ MIME declarado por cliente
4. Magic bytes del tipo declarado (positive match)

## Cadena de custodia geoespacial
`src/utils/dataCustody.js` → 3 tablas:
- `geo_custodia` — ciclo de vida (ingreso/actualización/publicación/despublicación/eliminación)
- `descarga_log` — quién descargó qué y cuándo
- `file_scan_log` — resultado del escaneo de cada archivo subido

## 2FA y seguridad de sesión
- TOTP via `otplib` — `POST /api/auth/2fa/setup`, `/api/auth/2fa/confirm`, `/api/auth/2fa/disable`
- Sesiones activas: `sessions` table — `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`
- Contraseña expirada: flag `password_expires_at` → redirige al flujo `/change-expired-password`
- Rate limiting: `authRateLimiter` en login, registro, 2FA y cambio de contraseña

## Reglas de Desarrollo
1. Patrón por módulo: `routes → controller → service → DB`
2. El controller solo llama al service y retorna JSON — sin lógica de negocio
3. El service lanza errores con `Object.assign(new Error(...), { status: N })`
4. Siempre usar `query()` de `config/database.js` — nunca pg directo
5. Paginación con helper `paginate()` de `utils/paginate.js`
6. Archivos: subir a R2 con `uploadFile()` de `config/r2.js`
7. Emails: usar funciones de `utils/mailer.js` — nunca nodemailer directo
8. Auditoría: llamar `registrarAuditoria()` en toda acción crítica
9. Commits convencionales: `feat:`, `fix:`, `refactor:`
10. No hay módulo noticias — fue eliminado del proyecto

## Setup inicial
```bash
cp .env.example .env   # Llenar credenciales
npm install
npm run migrate        # Crear tablas (migraciones 001–029)
ADMIN_SEED_PASSWORD=TuPassword123! npm run create-admin
npm run dev            # Servidor en puerto 4000
```

## Variables de entorno requeridas
Ver `.env.example` — las críticas son `DB_*`, `JWT_SECRET`, `R2_*`, `MAIL_*`, `FRONTEND_URL`.
Para el script de seed: `ADMIN_SEED_PASSWORD` (y opcionalmente `ADMIN_SEED_EMAIL`).
