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

## Contenido

- [Capacidades](#capacidades)
- [Tecnologías](#tecnologías)
- [Arquitectura](#arquitectura)
- [Primeros pasos](#primeros-pasos)
- [Documentación de la API](#documentación-de-la-api)
- [Roles y permisos](#roles-y-permisos)
- [Procesos programados](#procesos-programados)
- [Modo mantenimiento](#modo-mantenimiento)
- [Analítica y privacidad](#analítica-y-privacidad)
- [Rendimiento y pruebas de carga](#rendimiento-y-pruebas-de-carga)
- [Pruebas](#pruebas)
- [Operación](#operación)
- [Solución de problemas](#solución-de-problemas)
- [Convenciones](#convenciones)
- [Contribuir, seguridad y licencia](#contribuir)

---

## Capacidades

- **Mapas y documentos:** catálogo con metadatos técnicos, categorías y descarga controlada.
- **Geovisores:** conexión a servidores GeoServer, descubrimiento automático de capas y detección de capas nuevas.
- **Solicitudes de acceso** a información geoespacial, con flujo de aprobación.
- **Usuarios y permisos:** roles institucionales y permisos por módulo.
- **Trazabilidad:** registro de actividad con verificación de integridad y reportes para la administración.
- **Analítica de uso** anónima: visitas, orígenes, ubicación aproximada, acciones de los visitantes y tiempo real.
- **Notificaciones** dentro de la plataforma y por correo.
- **Seguridad por diseño:** validación de entradas, protección de archivos subidos, límites de tráfico y autenticación robusta.

---

## Tecnologías

- **Node.js 20+** con ES Modules y **Express**
- **PostgreSQL** con **PostGIS**
- **Redis** (opcional) para la caché de contenido público
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
├── middlewares/   # Autenticación, permisos, validación, caché, límites de tráfico
├── modules/       # Un directorio por dominio (mapas, documentos, geovisores, …)
└── utils/         # Utilidades compartidas
db/
└── migrations/    # Migraciones de base de datos, consecutivas
docs/              # Documentación técnica (rendimiento, guías)
loadtest/          # Herramienta de pruebas de carga
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

## Documentación de la API

En desarrollo (`NODE_ENV` distinto de `production`) la especificación OpenAPI se sirve en:

- `/api/docs` — interfaz interactiva
- `/api/docs.json` — especificación en JSON

En producción estas rutas están **deshabilitadas** a propósito.

---

## Roles y permisos

| Rol | Alcance |
|---|---|
| `super_admin` | Administración total: configuración de la plataforma, usuarios y permisos. |
| `admin_sig` | Administrador de contenidos. Cada módulo (ver / editar) se le concede de forma individual. |
| `investigador`, `tecnico`, `institucional` | Usuarios registrados; acceden a la información según su visibilidad. |
| `publico` | Visitante o usuario sin privilegios. |

El acceso de un `admin_sig` a cada módulo del panel (por ejemplo, geovisores o conexiones a servidores de mapas) lo concede un `super_admin`. Las rutas lo verifican con el middleware `requireModulo` y cada acceso denegado queda registrado en la trazabilidad.

---

## Procesos programados

Se ejecutan dentro del propio servicio, con temporizadores que no impiden su cierre ordenado:

| Proceso | Frecuencia | Qué hace |
|---|---|---|
| Informe semanal | Revisión cada hora | Envía por correo el resumen semanal a la administración, una vez por semana. |
| Retención de analítica | Cada 6 h | Elimina la IP de las sesiones antiguas (90 días por defecto) y los datos muy antiguos (730 días por defecto). |
| Retención de auditoría | Cada 24 h | Purga el registro de actividad según el plazo configurado. |
| Autoajuste de límites | Cada hora | Ajusta el límite de tráfico según el uso observado. |
| Reintento de correos | Cada minuto | Reenvía con espera creciente (hasta 5 intentos) los correos cuyo primer envío falló; al terminar borra su contenido. |

Los plazos de retención se configuran con variables de entorno (ver `.env.example`).

---

## Modo mantenimiento

Un `super_admin` puede activarlo desde el panel. Mientras está activo:

- Las rutas responden `503` con la cabecera `Retry-After`, salvo las de inicio de sesión y recuperación de acceso.
- Los administradores siguen entrando con normalidad.
- `GET /api/v1/estado` informa públicamente si la plataforma está en mantenimiento, sin requerir sesión ni caché.

---

## Analítica y privacidad

La analítica de uso es **propia y anónima**: no se comparte con terceros ni se liga a una cuenta.

- Se guardan páginas vistas, dispositivo, navegador, origen de la visita, ubicación aproximada de la sesión y acciones concretas (descargar un mapa, abrir un geovisor, usar una herramienta). Con ellas el panel calcula **embudos de conversión** (por ejemplo, portada → Mapas → descarga) y el **flujo de navegación** entre páginas, todo con datos propios y sin servicios de terceros.
- La dirección IP se conserva solo el tiempo configurado y luego se elimina automáticamente.
- Los bots se identifican y se excluyen de las cifras; las visitas al panel de administración se marcan aparte y tampoco cuentan en los informes, y desde el panel no se registran acciones.
- Los datos solo los consultan administradores con acceso al módulo de actividad.

---

## Rendimiento y pruebas de carga

- Los listados y detalles públicos se cachean en Redis (si está configurado) y se invalidan al editar el contenido. Si Redis no está disponible, el servicio funciona igual desde la base de datos.
- Las lecturas del panel de analítica usan una caché local de corta duración (`ANALITICA_CACHE_TTL_MS`, 30 s por defecto).
- La estrategia completa —índices, caché, procesos asíncronos y hoja de ruta— está en [`docs/ESTRATEGIA_RENDIMIENTO.md`](docs/ESTRATEGIA_RENDIMIENTO.md).
- Para medir antes y después de un cambio hay una herramienta sin dependencias:

```bash
node loadtest/carga.mjs --url http://localhost:4000 --duracion 30 --concurrencia 20
```

Úsala siempre contra un entorno propio; detalles en [`loadtest/README.md`](loadtest/README.md).

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

## Operación

- **Despliegue:** la imagen Docker se construye y publica automáticamente al fusionar en `main`; las migraciones se aplican al iniciar.
- **Migraciones:** son consecutivas, idempotentes y nunca se editan una vez fusionadas. Se aplican en orden alfabético por nombre.
- **Cierre ordenado:** ante `SIGTERM`/`SIGINT` el servicio termina las peticiones en vuelo y cierra el pool de conexiones.
- **Registro:** los eventos relevantes quedan en la trazabilidad (administración) y los errores en el registro de errores del panel.
- **Varias instancias:** hoy el servicio está pensado para una instancia. Antes de escalar a varias hay que resolver los planificadores y la revocación de tokens, descritos en el documento de rendimiento.

---

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| `429` en el panel de administración | El límite de tráfico del administrador es por usuario (`ADMIN_RATE_LIMIT_MAX`); en pruebas de carga sube `RATE_LIMIT_MAX`. |
| Un cambio de contenido no se ve en el sitio público | La caché pública se invalida al editar; si Redis estuvo caído puede tardar hasta que venza el TTL. |
| Todo responde `503` con un mensaje de mantenimiento | El modo mantenimiento está activo; un `super_admin` puede desactivarlo desde el panel. |
| Falla una migración al arrancar | Revisa que PostgreSQL tenga la extensión PostGIS; el error indica el archivo de migración. |
| `/api/docs` devuelve 404 | Es lo esperado en producción; la documentación solo se sirve en desarrollo. |

---

## Convenciones

- Patrón por módulo: rutas → controlador → servicio → base de datos.
- Validación de entradas con Zod en el borde del sistema.
- Acceso a datos siempre mediante el helper de consultas parametrizadas.
- Commits siguiendo [Conventional Commits](https://www.conventionalcommits.org).

---

## Contribuir

Lee la [guía de contribución](CONTRIBUTING.md): flujo de ramas (`develop` → `main`),
convención de commits y lista de verificación para Pull Requests.

## Seguridad

Para reportar una vulnerabilidad sigue la [política de seguridad](SECURITY.md).
**No abras un issue público.**

## Licencia

[MIT](LICENSE) © Instituto de Investigaciones Ambientales del Pacífico (IIAP)
