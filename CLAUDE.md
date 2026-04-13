# VIGIIAP-backend — API REST

## Stack
- **Runtime:** Node.js 20+ con ES Modules (`"type": "module"`)
- **Framework:** Express 4
- **DB:** PostgreSQL + PostGIS vía `pg` (Pool)
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Validación:** Zod (schemas en `*.schema.js`)
- **Storage:** Cloudflare R2 (compatible S3 — `@aws-sdk/client-s3`)
- **Logs:** Winston
- **Dev:** nodemon

## Estructura
```
src/
├── app.js                  # Express setup + rutas montadas
├── config/
│   ├── database.js         # Pool pg + helpers query/getClient
│   └── r2.js               # Cliente S3 para Cloudflare R2
├── middlewares/
│   ├── auth.js             # authenticate + authorize(...roles)
│   ├── errorHandler.js     # Global error handler
│   ├── notFound.js         # 404 handler
│   └── rateLimiter.js      # rateLimiter + authRateLimiter
├── modules/
│   ├── auth/               # login, registro, /me
│   ├── mapas/              # CRUD mapas
│   ├── documentos/         # CRUD documentos
│   ├── noticias/           # CRUD noticias
│   ├── solicitudes/        # Gestión solicitudes de acceso
│   └── usuarios/           # Admin de usuarios + cambio de contraseña
└── utils/
    ├── logger.js            # Winston
    ├── paginate.js          # Helper paginación SQL
    └── slugify.js           # Slugs en español
db/
├── migrate.js              # Runner de migraciones
└── migrations/
    └── 001_init.sql        # Schema inicial
server.js                   # Entry point
```

## Roles
- `admin_sig` — acceso total
- `investigador` — puede subir documentos, ver todo
- `publico` — solo lectura de recursos públicos

## API Endpoints
| Método | Ruta | Auth |
|--------|------|------|
| POST | /api/auth/login | — |
| POST | /api/auth/registro | — |
| GET | /api/auth/me | JWT |
| GET | /api/mapas | — |
| GET | /api/mapas/:slug | — |
| POST | /api/mapas | admin_sig |
| PUT | /api/mapas/:id | admin_sig |
| DELETE | /api/mapas/:id | admin_sig |
| GET | /api/documentos | — |
| GET | /api/documentos/:slug | — |
| POST | /api/documentos | admin_sig, investigador |
| DELETE | /api/documentos/:id | admin_sig |
| GET | /api/noticias | — |
| GET | /api/noticias/:slug | — |
| POST/PUT/DELETE | /api/noticias | admin_sig |
| GET | /api/solicitudes | admin_sig |
| GET | /api/solicitudes/mis-solicitudes | JWT |
| POST | /api/solicitudes | JWT |
| PATCH | /api/solicitudes/:id/estado | admin_sig |
| GET | /api/usuarios | admin_sig |
| PATCH | /api/usuarios/:id/rol | admin_sig |
| PATCH | /api/usuarios/me/password | JWT |
| POST | /api/auth/visitante | — |
| GET | /api/admin/usuarios | admin_sig |
| POST | /api/admin/usuarios | admin_sig |
| PATCH | /api/admin/usuarios/:id | admin_sig |
| GET | /api/admin/audit | admin_sig |

## Roles
- `admin_sig` — acceso total
- `investigador` — puede subir documentos, ver todo
- `publico` — solo lectura de recursos públicos (registro externo pendiente de activación)
- `visitante` — token temporal 8h, solo lectura pública, sin registro en usuarios

## Login dual
- **Institucional/Externo**: `POST /api/auth/login` con email + password
- **Visitante**: `POST /api/auth/visitante` con nombre opcional — genera token 8h y registra en tabla `visitantes` para trazabilidad

## Email notifications
`src/utils/mailer.js` — nodemailer SMTP:
- Registro → usuario recibe confirmación + admins reciben aviso
- Activación/desactivación → usuario recibe email
- Creación por admin → usuario recibe email con contraseña temporal
- Solicitud cambia estado → usuario recibe email con resultado
- Nueva solicitud → admins reciben aviso

## Auditoría
`src/utils/auditLog.js` → tabla `audit_log` — registra:
login, registro, login_visitante, create_usuario, update_usuario, update_rol,
change_password, create_solicitud, update_solicitud_estado

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

## Setup inicial
```bash
cp .env.example .env   # Llenar credenciales
npm install
npm run migrate        # Crear tablas en Supabase (correr 003_audit_notifications.sql también)
npm run dev            # Servidor en puerto 4000
```

## Variables de entorno requeridas
Ver `.env.example` — las críticas son `DB_*`, `JWT_SECRET`, `R2_*`, `MAIL_*`, `FRONTEND_URL`.
