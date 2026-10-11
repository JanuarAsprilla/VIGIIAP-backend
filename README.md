# VIGIIAP-backend

**API REST de la plataforma VIGIA-IIAP**

[![CI](https://github.com/JanuarAsprilla/VIGIIAP-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/JanuarAsprilla/VIGIIAP-backend/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org)

Servicio que da soporte a la plataforma de datos espaciales del
[Instituto de Investigaciones Ambientales del Pacífico (IIAP)](https://www.iiap.org.co):
gestión de mapas, documentos, geovisores y solicitudes de acceso a información geoespacial,
con control de acceso por roles y trazabilidad de las acciones.

Lo consume la aplicación web [VIGIIAP](https://github.com/JanuarAsprilla/VIGIIAP).

---

## Capacidades

- **Mapas y documentos:** catálogo con metadatos técnicos, categorías y descarga controlada.
- **Geovisores:** conexión a servidores GeoServer, descubrimiento automático de capas y detección de capas nuevas.
- **Solicitudes de acceso** a información geoespacial, con flujo de aprobación.
- **Usuarios y permisos:** roles institucionales y permisos por módulo.
- **Trazabilidad:** registro de actividad y reportes para la administración.
- **Notificaciones** dentro de la plataforma y por correo.
- **Seguridad por diseño:** validación de entradas, protección de archivos subidos, límites de tráfico y autenticación robusta.

---

## Tecnologías

- **Node.js 20+** con ES Modules y **Express**
- **PostgreSQL** con **PostGIS**
- Almacenamiento de archivos compatible con **S3**
- **Zod** para validación de datos
- **Vitest** para pruebas (unitarias e integración)
- Despliegue en contenedores con **Docker**

---

## Arquitectura

Cada módulo sigue la misma estructura en capas:

```
rutas → controlador → servicio → base de datos
```

El controlador valida la entrada y delega; la lógica de negocio vive en el servicio.

```
src/
├── config/        # Base de datos, almacenamiento y configuración
├── middlewares/   # Autenticación, permisos, validación, límites de tráfico
├── modules/       # Un directorio por dominio (mapas, documentos, geovisores, …)
└── utils/         # Utilidades compartidas
db/
└── migrations/    # Migraciones de base de datos, consecutivas
tests/             # Pruebas unitarias e integración
```

La API está versionada bajo `/api/v1`.

---

## Primeros pasos

### Opción A — Docker Compose (recomendada)

Levanta la aplicación, PostgreSQL/PostGIS y almacenamiento S3 local.

```bash
cp .env.example .env      # completa los valores indicados en el archivo
docker compose up -d --build
```

Las migraciones se aplican automáticamente al iniciar.

Para crear el primer usuario administrador define una contraseña segura propia:

```bash
docker compose exec -e ADMIN_SEED_PASSWORD='<contraseña-segura>' app npm run create-admin
```

### Opción B — Node local

Requiere PostgreSQL con PostGIS y un almacenamiento compatible con S3.

```bash
cp .env.example .env
npm install
npm run migrate
ADMIN_SEED_PASSWORD='<contraseña-segura>' npm run create-admin
npm run dev
```

El servidor queda disponible en `http://localhost:4000`.

### Configuración

Todas las variables de entorno están documentadas en [`.env.example`](.env.example).
Nunca subas tu archivo `.env` ni credenciales al repositorio.

---

## Pruebas

```bash
npm test                  # unitarias
npm run test:coverage     # con informe de cobertura
npm run test:integration  # integración (requiere base de datos)
npm run lint
```

Cada Pull Request ejecuta lint, pruebas, pruebas de integración con una base de datos
real, auditoría de dependencias y verificación de la imagen Docker.

---

## Convenciones

- Patrón por módulo: rutas → controlador → servicio → base de datos.
- Validación de entradas con Zod en el borde del sistema.
- Acceso a datos siempre mediante el helper de consultas parametrizadas.
- Commits siguiendo [Conventional Commits](https://www.conventionalcommits.org).
- Migraciones consecutivas, idempotentes y nunca editadas una vez fusionadas.

---

## Contribuir

Lee la [guía de contribución](CONTRIBUTING.md): flujo de ramas (`develop` → `main`),
convención de commits y lista de verificación para Pull Requests.

## Seguridad

Para reportar una vulnerabilidad sigue la [política de seguridad](SECURITY.md).
**No abras un issue público.**

## Licencia

[MIT](LICENSE) © Instituto de Investigaciones Ambientales del Pacífico (IIAP)
