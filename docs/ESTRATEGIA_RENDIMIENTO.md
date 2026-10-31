# Estrategia de rendimiento: base de datos, caché, procesos asíncronos y carga

Documento vivo del backend de VIGIIAP. Describe lo que existe, cómo se mide y qué se hará cuando el tráfico lo justifique. No contiene datos de infraestructura ni credenciales.

## 1. Principios

1. **Medir antes de optimizar.** Cada índice o caché de este documento tiene una medición detrás o una prueba que la puede repetir (`loadtest/`).
2. **Lo público se cachea; lo autenticado no.** Los listados públicos son idénticos para todos los visitantes, así que una respuesta sirve a miles de peticiones. Las respuestas con sesión nunca pasan por la caché compartida.
3. **La caché es una optimización, no una dependencia.** Si Redis no está disponible, el servicio responde desde la base de datos sin errores.
4. **Todo cambio de datos vacía su caché.** Un TTL largo sin invalidación muestra datos viejos.

## 2. Base de datos

### Índices

| Índice | Consulta que sirve | Medición (2,2 M de filas sintéticas) |
|---|---|---|
| Trigramas (`pg_trgm`, GIN) en `mapas`, `documentos` y `usuarios` | `ILIKE '%texto%'` de los listados y buscadores | usuarios: 8,5 ms → 0,5 ms |
| `descarga_log (usuario_email, created_at DESC)` | Historial de descargas por usuario | 14,7 ms → 0,1 ms |
| `refresh_tokens (expira_en)` y parcial de revocados | Purga de sesiones | evita recorrer la tabla |
| Seis claves foráneas (`creado_por`, `actualizado_por`, `tipo_clave`) | Borrado de usuarios y relaciones | evita recorridos completos |

Descartado a propósito: trigramas y prefijos sobre `audit_log`. No mejoraban las consultas reales y encarecían las escrituras de una tabla de solo anexado.

Se eliminaron tres índices duplicados (`idx_usuarios_email`, `idx_refresh_tokens_hash`, `idx_solicitudes_usuario_id`): los cubre una restricción `UNIQUE` o un índice compuesto con el mismo prefijo. Cada índice sobrante cuesta espacio y tiempo en cada escritura.

### Consultas

- **Resumen de auditoría (24 h):** filtrar por tiempo *antes* de agregar bajó la consulta de 1565 ms a 3,9 ms con el mismo resultado.
- **Analítica:** `getResumen` ya no trae cada vista a Node: cuenta en SQL. Lección de la medición: convertir la zona horaria fila por fila (`AT TIME ZONE`) resultó **más lento** que traer las filas (505 ms frente a 396 ms con 300 000 vistas), así que se agrupa primero por hora y solo esas ~336 horas se convierten al día de Bogotá (369 ms, sin transferir ni guardar las filas en memoria). El resto del tiempo es la consulta de rebote y duración, igual que antes. Los conteos diarios se calculan ahora en hora de Colombia sin importar la zona del servidor.

### Cómo revisar una consulta lenta

```sql
EXPLAIN (ANALYZE, BUFFERS) <consulta>;
```

Señales de alerta: `Seq Scan` sobre tablas grandes, `Rows Removed by Filter` muy superior a las filas devueltas, y ordenaciones en disco. Un índice nuevo se justifica cuando la mejora medida es clara y la tabla no es de escritura intensiva.

## 3. Caché

### 3.1 Qué se cachea hoy (Redis, solo visitantes sin sesión)

| Recurso | TTL |
|---|---|
| Listados de mapas, documentos y geovisores | 2 min |
| Detalle de mapa, documento y geovisor | 5 min |
| Catálogo de capas de un geovisor | 30 s |
| Configuración pública | 5 min |
| Categorías y herramientas | 10 min |

Reglas del middleware (`src/middlewares/cache.js`):

- La clave incluye la ruta de montaje (`baseUrl`) y solo una lista cerrada de parámetros (`page`, `limit`, `categoria`, `q`, `anio`, `tipo`) para que nadie pueda inflar Redis con claves únicas.
- Solo se guardan respuestas `200`; un `404` o `500` cacheado se serviría como válido durante todo el TTL.
- Las peticiones con cookie o cabecera de autorización nunca se cachean.
- Si Redis falla, la petición continúa sin caché.

### 3.2 Invalidación

Toda escritura sobre un recurso público llama a `invalidarRecurso(nombre)`, que vacía las entradas de `/api` y de `/api/v1` (el mismo router se monta en ambas rutas). Se usa `SCAN` y no `KEYS`, porque `KEYS` bloquea Redis mientras recorre todas las claves.

Cuando una entidad aparece dentro de otras, se invalidan también esas (renombrar una categoría vacía categorías, mapas, documentos y geovisores).

Regla para código nuevo: si un endpoint `GET` usa `cacheMiddleware`, cada `POST/PUT/PATCH/DELETE` del mismo recurso debe llamar a `invalidarRecurso`.

### 3.3 Caché local de corta duración para la analítica de administración

Los tableros de administración son autenticados y pesados, pero los consultan pocas personas. `memoizar` (`src/utils/cacheLocal.js`) guarda el resultado en memoria del proceso 30 s (`ANALITICA_CACHE_TTL_MS`, en 0 se desactiva) y hace *single-flight*: varias peticiones simultáneas comparten una sola consulta. Los errores no se guardan y hay un máximo de 50 entradas por función.

Se aplica a resumen, páginas más vistas, dispositivos, fuentes, entrada y salida y ubicaciones. **No** se aplica al tiempo real (debe ser vivo) ni a las sesiones recientes (llevan IP). Es seguro mezclar usuarios porque estos datos son los mismos para cualquier administrador con acceso al módulo, que se verifica antes de llegar a la función. Con varias instancias cada una tendría su propia copia, lo que es aceptable para un desfase de 30 s.

### 3.4 Medición

Entorno local, una instancia de Node, PostgreSQL con 3 000 mapas y 3 000 documentos sintéticos, 20 conexiones concurrentes durante 20 s, escenario `publico`:

| | Peticiones/s | p50 | p95 | p99 | Errores |
|---|---|---|---|---|---|
| Sin Redis | 1054 | 12 ms | 61 ms | 97 ms | 0 |
| Con Redis | 5443 | 3 ms | 7 ms | 11 ms | 0 |

La caché multiplica por 5,2 el rendimiento y reduce el p95 unas ocho veces. Sin caché la ruta más lenta es `/categorias` (p50 56 ms, calcula conteos por categoría), la que más gana con ella. Son cifras de una máquina de desarrollo: sirven para comparar antes y después, no como capacidad de producción.

## 4. Procesos asíncronos

### Inventario

| Proceso | Frecuencia | Observación |
|---|---|---|
| Informe semanal por correo | revisión cada hora | Estado persistido; envía una vez por semana |
| Retención de analítica | cada 6 h | Purga de ubicación e IP |
| Retención de auditoría | cada 24 h | Activa la bandera de purga dentro de su transacción |
| Autoajuste del límite de tasa | cada hora | Lee tráfico y ajusta el límite dinámico |
| Alertas de seguridad | por evento | Correo a administradores |
| Lista de tokens revocados | en memoria, cargada al arrancar | Se persiste en base de datos |

Todos los temporizadores usan `unref()` y el servidor cierra de forma ordenada con `SIGTERM`/`SIGINT` (termina las peticiones en vuelo y cierra el pool).

### Riesgos conocidos al crecer

Hoy el servicio corre como **una instancia**, y con una instancia todo lo anterior es correcto. Al añadir una segunda instancia aparecen estos puntos:

1. **Planificadores duplicados.** Cada instancia ejecutaría el informe semanal y las purgas. Solución prevista: un bloqueo de asesoría en PostgreSQL (`pg_try_advisory_lock`) al inicio de cada tarea, de modo que solo una instancia la ejecute. No requiere infraestructura nueva.
2. **Lista de tokens revocados en memoria.** Un cierre de sesión atendido por la instancia A no lo vería la instancia B hasta reiniciarse. Solución prevista: consultar la tabla de revocados con una caché de pocos segundos, o publicar la revocación por Redis.
3. **Correo síncrono sin reintentos.** Cada envío crea su transporte SMTP y, si falla, el correo se pierde (se registra el error). Solución prevista, en este orden:
   1. reutilizar un único transporte con *pool*;
   2. tabla `correos_pendientes` (patrón *outbox*): la petición solo inserta una fila en su misma transacción;
   3. un trabajador toma lotes con `SELECT … FOR UPDATE SKIP LOCKED`, envía, y reintenta con espera creciente hasta un máximo de intentos, marcando los fallidos para revisión.

   Así un SMTP caído no demora ni rompe el registro, la recuperación de contraseña ni las alertas, y se mantiene la garantía de «al menos una vez» sin añadir un servicio externo.
4. **Trabajo pesado en el hilo del servidor.** El procesamiento de imágenes y el cifrado de contraseñas usan el pool de hilos de libuv (4 por defecto). Si la carga de subidas crece, subir `UV_THREADPOOL_SIZE` o mover el trabajo a un proceso aparte.
5. **Exportaciones en memoria.** Las exportaciones cargan hasta 10 000 filas. Para volúmenes mayores, transmitirlas por bloques (cursor) en lugar de armarlas completas.

Ninguno exige actuar hoy; todos se vuelven necesarios si se despliegan varias instancias. Conviene resolver 1 y 2 antes de ese día, y 3 cuando el correo sea crítico para el negocio.

## 5. Pruebas de carga

El kit está en [`loadtest/`](../loadtest/README.md): un script sin dependencias externas con escenarios ponderados, percentiles por ruta y umbrales que hacen fallar el proceso (apto para CI).

Presupuesto sugerido para el escenario público, sobre un entorno equivalente a producción:

| Indicador | Objetivo |
|---|---|
| p95 | menor de 500 ms |
| Tasa de error (5xx y fallos de red) | menor de 1 % |
| Respuestas 429 | 0 con el límite del entorno de prueba elevado; se revisan aparte |

Cuándo ejecutarlas: antes de cada release que toque consultas o caché, y tras cambiar el hardware o el número de instancias. Nunca contra producción sin avisar: los límites de tasa por IP se activarán y la prueba compite con usuarios reales.

## 6. Hoja de ruta

| Prioridad | Acción | Estado |
|---|---|---|
| Alta | Índices medidos, resumen de auditoría y limpieza de duplicados | Hecho |
| Alta | Invalidación de caché en `/api` y `/api/v1`, incluidos los geovisores | Hecho |
| Alta | Kit de pruebas de carga y línea base | Hecho |
| Media | Analítica agregada en SQL + caché local de administración | Hecho |
| Media | Transporte SMTP reutilizable y cola *outbox* de correos | Pendiente |
| Antes de escalar | Bloqueo de asesoría en planificadores y revocación compartida de tokens | Pendiente |
| Baja | Exportaciones por cursor | Pendiente |
