# Portal de Geovisores — diseño de datos y permisos (borrador)

Estado: **borrador para revisión** — sirve de base tanto para el módulo `geovisores` que se
construirá aquí en VIGIIAP-backend/VIGIIAP como para la extracción de configuración del geovisor
plantilla en `producto6-reportes-vigia`. No implementar contra esto sin confirmar cada sección.

## 0. Contexto y decisión de alcance

El módulo "Geovisor" (antes solo un campo suelto `geovisor_url` en `mapas`, ver
`src/modules/mapas/mapas.schema.js`) pasa a ser una entidad propia con su propio CRUD. El objetivo:
un `super_admin`/`admin_sig` crea un geovisor nuevo desde el panel de VIGIIAP (sin tocar código),
eligiendo qué mostrar y cómo, reutilizando la MISMA base de código de geovisor (la que se construyó
como prototipo en `producto6-reportes-vigia`) parametrizada por esta configuración.

Confirmado con el usuario (2026-09-15):
- Las categorías de geovisores reutilizan la tabla `categorias` YA existente (compartida hoy entre
  `mapas.categoria` y `documentos.tipo` — ver `db/migrations/010_add_categorias_thumbnail.sql`). No
  se crea una tabla de categorías separada.
- Hoy existe un solo servidor GeoServer institucional, pero debe ser trivial agregar más adelante
  sin cambiar código — por eso las conexiones GeoServer son una tabla propia (`conexiones_geoserver`)
  desde el día uno, no una clave suelta en el `CONFIG_SCHEMA` de Configuración general (ese
  mecanismo es para settings singleton tipo SMTP, no para una colección de N conexiones).
- El color por tema en la leyenda NO es exclusivo de `super_admin` — es contenido rutinario de cada
  geovisor, así que lo gestiona `admin_sig` igual que el resto de la configuración del geovisor.
  `super_admin` queda reservado para la infraestructura (las conexiones GeoServer en sí).

## 1. Tabla `conexiones_geoserver`

Una fila por servidor GeoServer. Hoy habrá una sola fila (el servidor actual, migrado desde las
env vars `GEOSERVER_URL`/`GEOSERVER_READONLY_USER`/`GEOSERVER_READONLY_PASSWORD`/
`GEOSERVER_TIMEOUT_MS` de producto6); agregar un segundo servidor es solo un INSERT vía el CRUD.

```sql
CREATE TABLE conexiones_geoserver (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,              -- "GeoServer institucional IIAP", etc. (solo interno)
  url             TEXT NOT NULL,               -- https://.../geoserver
  usuario_lectura TEXT NOT NULL,               -- SIEMPRE un usuario de solo-lectura, nunca admin
  password_cifrado TEXT NOT NULL,              -- cifrado en reposo (mismo mecanismo que otros secretos del sistema, a definir con seguridad)
  timeout_ms      INTEGER NOT NULL DEFAULT 20000,
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- CRUD exclusivo de `super_admin` (crear/editar/eliminar servidor, ver credenciales). `admin_sig`
  puede LEER el nombre de cada conexión (para elegir a cuál apunta un geovisor) pero nunca ve
  `password_cifrado` ni puede editarla — mismo patrón que ya existe para ocultarle a `admin_sig`
  las claves exclusivas de `super_admin` en Configuración general.
- Nunca se guarda la contraseña en texto plano ni se expone en ningún endpoint de lectura.

## 2. Tabla `geovisores`

Una fila por geovisor publicado. `workspaces_geoserver` sigue el mismo principio que producto6 ya
tiene: el catálogo de capas se DESCUBRE en vivo contra GeoServer (WMS/WFS), nunca se copian capas a
esta tabla — este campo solo filtra qué workspaces de esa conexión aplican a este geovisor.

```sql
CREATE TABLE geovisores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,        -- URL-friendly, ej. "reportes-ambientales"
  titulo                TEXT NOT NULL,
  subtitulo             TEXT,                        -- ej. "IIAP · Laboratorio de Datos · Producto 6"
  descripcion           TEXT,
  categoria             TEXT REFERENCES categorias(nombre),
  conexion_geoserver_id UUID NOT NULL REFERENCES conexiones_geoserver(id),
  workspaces_geoserver  TEXT[] NOT NULL DEFAULT '{}',  -- vacío = todos los workspaces de esa conexión
  color_por_tema        JSONB DEFAULT '{}',            -- { "clima": "#218842", ... } -- paleta IIAP aprobada, no color libre
  centro_lat            DOUBLE PRECISION NOT NULL,
  centro_lng            DOUBLE PRECISION NOT NULL,
  zoom_inicial          SMALLINT NOT NULL DEFAULT 8,
  basemap_defecto       TEXT NOT NULL DEFAULT 'calles', -- id de la lista fija de basemaps gratuitos
  area_max_ha           NUMERIC,                        -- reemplaza REPORTE_AREA_MAX_HA fijo
  presets_area          JSONB DEFAULT '[]',             -- [{ "nombre": "Quibdó", "geometria": {...GeoJSON} }]
  ia_habilitada         BOOLEAN NOT NULL DEFAULT false,
  visibilidad           TEXT NOT NULL DEFAULT 'publico', -- 'publico' | 'usuarios' | 'acreditados' -- MISMO enum que mapas.visibilidad
  thumbnail_url         TEXT,
  activo                BOOLEAN NOT NULL DEFAULT true,
  orden                 SMALLINT NOT NULL DEFAULT 0,
  creado_por            UUID REFERENCES usuarios(id),
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `visibilidad` reutiliza EXACTAMENTE el mismo enum ya usado en `mapas.visibilidad`
  (`'publico' | 'usuarios' | 'acreditados'`) — no se inventa un mecanismo de acceso nuevo.
- `color_por_tema`: la pregunta pendiente era automatizarlo leyendo el SLD real de GeoServer vs.
  que lo asigne un admin a mano. El usuario no cerró esto todavía — queda para una decisión
  separada; el campo JSONB soporta ambos caminos (asignado a mano hoy, autogenerado después sin
  cambiar el esquema).

## 3. Matriz de permisos (mapeada a los roles reales de `rol_usuario`)

Roles confirmados contra las migraciones reales (no contra memoria vieja):
`super_admin`, `admin_sig`, `tecnico`, `institucional`, `investigador`, `publico`.

| Acción | super_admin | admin_sig | tecnico | institucional / investigador | publico |
|---|---|---|---|---|---|
| Crear/editar/eliminar conexión GeoServer (URL, credenciales) | ✅ | ❌ (solo lee el nombre) | ❌ | ❌ | ❌ |
| Crear/editar/publicar un geovisor (título, categoría, workspaces, centro/zoom, básemap, presets, color por tema, límite de área) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Desactivar/reordenar geovisores en el listado | ✅ | ✅ | ❌ | ❌ | ❌ |
| Usar el geovisor (ver capas, dibujar área, medir, generar reporte) — según `visibilidad` | ✅ | ✅ | ✅ | ✅ (si visibilidad lo permite) | ✅ (solo `publico`) |

`admin_sig` queda como el rol de curaduría diaria de geovisores — igual que ya cura mapas y
documentos — mientras `super_admin` se reserva exclusivamente la capa de infraestructura
(conexiones GeoServer). `tecnico` es usuario avanzado (herramientas SIG completas) pero no editor
de la plantilla, consistente con cómo ya se distingue de `admin_sig` en el resto de VIGIIAP.

## 4. Cómo esto cierra el círculo con producto6

La auditoría del geovisor plantilla (`producto6-reportes-vigia/docs/MODELO_DATOS_REPORTE.md` §
gaps, 2026-09-15) encontró que el prototipo tiene hardcoded exactamente los mismos campos que esta
tabla `geovisores` ahora modela: centro/zoom, `API_BASE`/conexión GeoServer, preset "Quibdó",
`COLOR_TEMA`, título/branding, límite de área. El siguiente paso técnico en producto6 (fuera de
este documento) es extraer esos valores a UN objeto `configGeovisor` inyectado al cargar la página
— con exactamente este shape — para que sea trivial servir la misma página con una fila distinta de
`geovisores` una vez este módulo exista en VIGIIAP.

## 5. Pendiente / fuera de este borrador

- Mecanismo de cifrado de `password_cifrado` (reutilizar lo que ya use el sistema para otros
  secretos, si existe algo establecido — verificar antes de implementar).
- Decisión final sobre `color_por_tema`: manual vs. derivado de SLD (ver § 2).
- Endpoints REST concretos (`/api/geovisores`, `/api/admin/geovisores`, `/api/admin/conexiones-geoserver`) y sus schemas Zod — se definen cuando se implemente, no en este borrador.
- Migración de datos: no hay geovisores existentes que migrar (hoy es un campo suelto en `mapas`), así que no se requiere backfill, solo la migración de esquema.
