# Escalado de VIGIIAP-backend: de una instancia a muchos usuarios simultáneos

Guía para preparar la plataforma ante mucho tráfico. Complementa [`ESTRATEGIA_RENDIMIENTO.md`](ESTRATEGIA_RENDIMIENTO.md) (índices, caché, procesos asíncronos) y el kit de [`loadtest/`](../loadtest/README.md). No contiene credenciales ni datos de infraestructura.

> **Honestidad sobre las cifras.** Hoy corre **una sola instancia** de Node y **nadie ha medido la capacidad real de producción**. Las únicas mediciones de este documento son las de la sección 7, hechas en un portátil de desarrollo y marcadas así; sirven para comparar antes y después, no para prometer un número de usuarios. Todo umbral de las secciones 6 y 8 es una **propuesta inicial** que debe recalibrarse con pruebas en un entorno equivalente al de producción.

## 1. Qué hay y qué falta

Ya resuelto (ver `ESTRATEGIA_RENDIMIENTO.md`, sección 4): planificadores con candado de asesoría, tokens revocados sincronizados entre instancias (~15 s), contadores del limitador en Redis, cola de correos con reintentos.

Esta serie de PR añade, **todo apagado o con el comportamiento actual por defecto**:

| Tema | Variable (valor por defecto) | Qué cambia al activarla | Conviene activarla |
|---|---|---|---|
| Hilos de libuv | `UV_THREADPOOL_SIZE` (16 en la imagen; libuv usa 4 si no se define) | El cifrado de contraseñas y `sharp` no se encolan tras 4 hilos | Ya: la imagen la fija y no cambia el comportamiento |
| Pool de PostgreSQL | `DB_POOL_MAX` (20) | Tamaño del pool por instancia | Al pasar a varias instancias, reducirlo (sección 3) |
| Analítica por lotes | `ANALITICA_COLA` (apagada), `ANALITICA_COLA_TOPE` (5000), `ANALITICA_COLA_LOTE` (200), `ANALITICA_COLA_INTERVALO_MS` (2000) | El beacon solo encola; escritura multifila | Cuando la analítica compita con el resto por conexiones de BD (sección 7 muestra el efecto) |
| Descargas | sin variable | Se destruye el origen S3 si el cliente aborta | Ya aplicado al fusionar |
| Cabeceras de CDN | `CDN_CACHE_HEADERS` (apagada), `CDN_BROWSER_MAX_AGE_S` (30) | `public` + `s-maxage` en lo público; `private, no-store` en lo demás | Solo al poner un CDN delante (etapa 1) |
| Modo degradado | `LOAD_SHEDDING` (apagado), umbrales `LOAD_SHED_*` | 503 + `Retry-After` a lo no crítico y, al extremo, al resto | Tras calibrar umbrales con una prueba de carga |
| Salud | `READY_REDIS_OBLIGATORIO` (false), `READY_TIMEOUT_MS` (1500), `READY_CACHE_MS` (2000) | `/health/ready` y `/health/live` | Al poner un balanceador: apuntar su comprobación a `/health/ready` |

## 2. Arquitectura objetivo por etapas

**Etapa 0 (hoy).** Un contenedor Node, PostgreSQL, Redis opcional. Lo público ya se cachea en Redis para visitantes sin sesión.

**Etapa 1: CDN/WAF delante, caché de borde.** Lo más barato y de mayor efecto: la mayoría del tráfico son lecturas públicas idénticas para todos (`mapas`, `documentos`, `categorias`, `geovisores`, configuración). Con `CDN_CACHE_HEADERS=true` esas respuestas llevan `s-maxage` y el borde las sirve sin tocar el servidor. El WAF absorbe abusos y bots. Sin cambios en la aplicación más allá de las cabeceras.

**Etapa 2: 3-4 instancias + Redis + PgBouncer.** Un balanceador (`deploy/escala/nginx-balanceador.conf`) reparte con `least_conn` entre réplicas; Redis comparte caché y contadores del limitador; PgBouncer en modo transacción multiplexa las conexiones a PostgreSQL. Ejemplo completo en `deploy/escala/docker-compose.escala.yml`.

**Etapa 3: réplica de lectura.** Cuando la BD sea el cuello (CPU o E/S de PostgreSQL, no las conexiones), una réplica de lectura para listados públicos y analítica de administración. Requiere separar lecturas de escrituras en el acceso a datos: **no está hecho**; es trabajo de código y no solo de infraestructura.

```
visitante -> CDN/WAF (etapa 1) -> nginx least_conn -> app x N -> PgBouncer -> PostgreSQL
                                                          \-> Redis (caché + limitador)
```

## 3. Cómo dimensionar

1. **Carga objetivo:** `peticiones/s = usuarios simultáneos x peticiones por usuario por segundo`. Una persona navegando suele generar una ráfaga al cargar la SPA y luego poco; medir el valor real con la analítica propia (peticiones por sesión) en lugar de suponerlo. Ejemplo solo aritmético: 2 000 simultáneos x 0,5 peticiones/s = 1 000 peticiones/s.
2. **Qué parte llega al servidor:** `req/s al origen = req/s totales x (1 - tasa de acierto del CDN)`. La tasa de acierto solo se conoce midiéndola en el panel del CDN tras activarlo.
3. **Instancias:** `instancias = ceil(req/s al origen / req/s medidos por instancia)`, con un margen (30-40 %) para picos y para perder una instancia. El `req/s por instancia` sale de `loadtest/` en el entorno aparte, no de este documento.
4. **Pool de BD por instancia:** `DB_POOL_MAX = conexiones totales disponibles / instancias`. Con PgBouncer, las conexiones totales son `DEFAULT_POOL_SIZE` (hacia PostgreSQL), no `max_connections`; cada instancia puede tener un `DB_POOL_MAX` mayor que su parte porque PgBouncer las multiplexa. Sin PgBouncer: `(max_connections - reservadas para administración y migraciones) / instancias`. Hay además un pool de biodiversidad por instancia (`BIODIVERSIDAD_POOL_MAX`, por defecto 6): cuenta en el total.
5. **Redis:** memoria suficiente para claves de caché y contadores; todas tienen TTL. Vigilar `used_memory` y expulsiones.

## 4. Guía de Cloudflare (u otro CDN)

Los nombres de menús cambian con el tiempo y las funciones dependen del plan: verifique cada punto en el panel vigente.

**Base.** DNS del dominio de la API con proxy activado. Modo TLS «Full (strict)» con certificado válido en el origen. Restringir el origen a las IP del CDN (cortafuegos) y, si el plan lo permite, «Authenticated Origin Pulls». En nginx, descomentar `set_real_ip_from`/`real_ip_header CF-Connecting-IP` (ver el archivo): sin eso la aplicación vería la IP del CDN y el limitador de tráfico trataría a todos los visitantes como uno.

**Reglas de caché (respetan las cabeceras del PR de CDN).**

1. *Bypass* de caché si hay credenciales: la petición trae la cookie `vigiiap_token` o la cabecera `Authorization` (expresión del tipo `http.cookie contains "vigiiap_token"` o presencia de la cabecera `authorization`). Es redundante con `private, no-store`, pero deja la protección en dos capas.
2. *Elegible para caché* solo para rutas `GET` públicas: `/api/v1/mapas*`, `/api/v1/documentos*`, `/api/v1/categorias*`, `/api/v1/herramientas*`, `/api/v1/geovisores*` (excluyendo `.../wms` y `.../leyenda`, que son proxys binarios), `/api/v1/public/configuracion`, `/api/v1/biodiversidad/estado`. TTL de borde: **respetar el del origen** (`s-maxage`). No usar «cachear todo» ni TTL fijos que ignoren `private`.
3. **No** cachear: `/api/v1/auth/*`, `/api/v1/admin/*`, `/api/v1/usuarios*`, `/api/v1/solicitudes*`, `/api/v1/descargar/*`, `/api/v1/analitica/*`, `/api/v1/notificaciones*`, `/api/v1/estado` (refleja el modo mantenimiento).
4. **Invalidación.** La invalidación de Redis al editar contenido **no purga el CDN**: el borde puede servir la versión anterior hasta `s-maxage` (2-10 min según la ruta). Si un cambio debe verse al instante, purgar por URL o prefijo con la API del CDN. Automatizarlo es trabajo futuro; hoy es manual.

**WAF y limitación de tasa (propuesta inicial; ajustar con tráfico real).**

| Regla | Ruta | Umbral sugerido | Acción |
|---|---|---|---|
| Fuerza bruta de acceso | `/api/v1/auth/login`, `/auth/2fa/*`, `/auth/recuperar-password`, `/auth/registro` | ~10 por minuto por IP | Bloquear o desafío varios minutos |
| Beacon de analítica | `/api/v1/analitica/pageview`, `/evento` | ~60 por minuto por IP | Bloquear |
| General de la API | `/api/*` | ~300 por minuto por IP (una oficina o campus comparte IP: no bajar sin datos) | Desafío |
| Escaneos | rutas inexistentes repetidas, agentes conocidos de escaneo | reglas administradas | Bloquear |

Activar el conjunto administrado de reglas del WAF y la protección contra bots en modo de observación primero (solo registrar), revisar falsos positivos con tráfico real y recién entonces bloquear. Tener a mano el modo de emergencia «Under Attack» para ataques en curso. El límite de la propia aplicación (`rateLimiter.js`) **no se toca**: el del CDN se suma por delante.

## 5. Pruebas de carga en un entorno aparte

Nunca contra producción. Pasos con `loadtest/`:

1. Levantar un entorno equivalente (misma imagen, BD con datos de tamaño real, Redis). Con `deploy/escala/docker-compose.escala.yml` si se prueba la etapa 2.
2. Elevar `RATE_LIMIT_MAX` en ese entorno: con una sola IP el limitador responde 429 y se mediría el limitador, no el servicio.
3. Ejecutar desde otra máquina (el generador compite por CPU si está en la misma):
   - `node loadtest/carga.mjs --url http://ENTORNO --escenario publico --duracion 60 --concurrencia 100`
   - `node loadtest/carga.mjs --url http://ENTORNO --escenario analitica --duracion 60 --concurrencia 100` (beacon `POST`)
4. Subir la concurrencia por escalones hasta que el p95 supere el objetivo o aparezcan errores: el escalón anterior es la capacidad de ese entorno.
5. Repetir **antes y después** de cada cambio y con los mismos datos; guardar la salida.
6. Mientras corre, vigilar las métricas de la sección 6 en el servidor de pruebas.

## 6. Métricas a vigilar y umbrales para escalar

Propuesta inicial; recalibrar con las pruebas de la sección 5.

| Métrica | Dónde verla | Atención | Acción |
|---|---|---|---|
| CPU de la instancia | `docker stats`, monitor del host | > 70 % sostenido | Añadir instancia |
| Retraso del bucle de eventos (p99) | registro del modo degradado, o `perf_hooks` | > 100 ms sostenido | Añadir instancia o revisar trabajo síncrono |
| Latencia p95 de la API | registro de acceso, CDN, `loadtest/` | > 500 ms (presupuesto de `ESTRATEGIA_RENDIMIENTO.md`) | Revisar consulta lenta o escalar |
| Tasa de 5xx | registro de acceso, CDN | > 1 % | Investigar antes de escalar |
| Conexiones de BD en uso | `pg_stat_activity` / estadísticas de PgBouncer | > 80 % del presupuesto, o clientes esperando en PgBouncer | Subir `DEFAULT_POOL_SIZE` (si PostgreSQL aguanta) o reducir consultas |
| CPU/E/S de PostgreSQL | monitor de la BD | CPU > 70 % sostenida | Índices/consultas; luego réplica de lectura |
| Memoria y expulsiones de Redis | `redis-cli info` | `evicted_keys` creciendo | Subir memoria o revisar TTL |
| Tasa de acierto del CDN | panel del CDN | baja respecto a lo esperado | Revisar reglas y cabeceras |
| Peticiones descartadas por el modo degradado | registro (`[degradacion]`) | cualquier `ENTRA` | Escalar o calibrar umbrales |
| Eventos de analítica descartados | registro (`[cola:analitica]`) | cualquier aviso | Subir `ANALITICA_COLA_LOTE` o revisar la BD |
| `/health/ready` | balanceador | 503 | Revisar BD (o drenado por cierre) |

## 7. Línea base medida (portátil de desarrollo)

**Entorno, no representativo de producción:** Apple M1 Max (10 núcleos, 32 GB), Node 24 en el anfitrión (la imagen usa Node 26), PostgreSQL/PostGIS 16 y Redis 7 en contenedores locales, **una instancia**, generador de carga en la misma máquina, 3 000 mapas y 3 000 documentos sintéticos, `RATE_LIMIT_MAX` elevado, 50 conexiones concurrentes, 20 s por escenario, Redis vaciado antes de cada serie. Una sola ejecución por celda: **sin repeticiones ni intervalos de confianza**, así que diferencias de pocos puntos porcentuales son ruido.

| Escenario | Configuración | Peticiones/s | p50 | p95 | p99 | Errores |
|---|---|---|---|---|---|---|
| `publico` (lecturas con caché Redis) | actual (develop) | 6 965 | 7 ms | 12 ms | 16 ms | 0 |
| `publico` | con todos los cambios de esta serie | 6 957 | 7 ms | 12 ms | 16 ms | 0 |
| `analitica` (beacon `POST`) | actual (una escritura por visita) | 2 393 | 20 ms | 31 ms | 45 ms | 0 |
| `analitica` | `ANALITICA_COLA=true` | 9 809 | 5 ms | 8 ms | 10 ms | 0 |

Lectura honesta de esto:

- Las lecturas públicas **no cambian**: ya salían de Redis y la serie no toca ese camino (la diferencia de 0,1 % es ruido). Con el modo degradado encendido pero sin carga que lo active, `publico` dio 6 709 req/s en una corrida de 15 s, dentro del ruido de una sola medición, sin diferencia que se pueda atribuir.
- El beacon con cola respondió unas 4 veces más rápido en este equipo y persistió las 156 826 vistas enviadas (comparadas con la tabla). La mejora es del **camino de la petición**: la escritura se desplaza a lotes. Con la BD en el mismo equipo, el cuello pasó a ser el generador de carga.
- **Límite hallado:** con 600 conexiones simultáneas contra el beacon (~10 000 req/s sostenidos) la cola de 5 000 se llenó y descartó **al menos 47 803 eventos** (~32 % de las 149 762 peticiones de esa corrida), con aviso en el registro y sin tumbar el servicio. Es el comportamiento diseñado (el tope protege la memoria), pero muestra que el ritmo de escritura por lotes tiene un techo en este equipo: subir `ANALITICA_COLA_LOTE` o repartir la analítica entre instancias es lo que toca si el tráfico real se acerca a eso.
- El modo degradado se verificó contra un servidor real con un umbral artificialmente bajo de peticiones en vuelo: devolvió 503 al beacon (31 637 respuestas de error) mientras `/health/live` y `/api/v1/mapas` siguieron en 200. Con los umbrales por defecto **no se activó** en este equipo en ninguna corrida. (Esta prueba reveló oscilaciones de entrada y salida cada segundo, corregidas con `LOAD_SHED_MANTENER_MS`.)
- **No hay medición** del efecto de `UV_THREADPOOL_SIZE`, de `DB_POOL_MAX`, de varias instancias, de PgBouncer ni de un CDN; no se inventan números para ellos.

## 8. Plan de degradación

Orden de lo que se sacrifica, de menos a más importante, al activar `LOAD_SHEDDING=true`:

1. **Nivel degradado** (retraso del bucle p99 >= 200 ms o >= 400 peticiones en vuelo, por defecto): 503 con `Retry-After` al beacon de analítica, exportaciones, informes y listados de actividad. Se pierde analítica y se retrasan reportes; el sitio público sigue.
2. **Nivel extremo** (>= 1 000 ms o >= 1 500 en vuelo): también al resto de la API. Quedan **siempre** `/health*`, `/estado`, login, refresh, logout, CSRF, 2FA y OAuth.
3. Se sale tras `LOAD_SHED_MANTENER_MS` (10 s) y cuando la medida baja del 70 % del umbral.

Antes de activarlo en producción: calibrar umbrales con la sección 5, probar en el entorno aparte que `/health/ready` sigue 200 bajo carga y avisar al equipo del frontend de que debe tratar 503 + `Retry-After` con un mensaje claro y un reintento con espera. El frontend es un repositorio aparte y **este cambio no lo toca**.

Si el modo degradado se activa a menudo, no es un ajuste de umbrales: es la señal de añadir capacidad.

## 9. Activación por etapas recomendada

1. Fusionar los PR (todo apagado). Redesplegar: `UV_THREADPOOL_SIZE=16` ya queda activo.
2. Etapa 1: poner el CDN, **observar** (sin caché ni bloqueos) una semana; activar `CDN_CACHE_HEADERS=true` y las reglas de caché; luego el WAF en modo bloqueo.
3. Activar `ANALITICA_COLA=true` si el beacon compite con el resto por la BD.
4. Etapa 2 cuando la medición lo pida: entorno aparte, `docker-compose.escala.yml`, prueba de carga, y solo entonces producción con un cambio a la vez.
5. `LOAD_SHEDDING=true` al final, con umbrales calibrados.

## 10. Riesgos conocidos al escalar horizontalmente

- **Migraciones sin candado.** `db/migrate.js` se ejecuta al arrancar cada réplica (el `Dockerfile` y `server.js`). Con varias réplicas arrancando a la vez y una migración nueva pendiente, compiten: una gana y la otra falla y se reinicia. El ejemplo de compose lo evita con un servicio `migrar` previo; en cualquier otro despliegue, actualizar réplica por réplica. Candado de asesoría en el ejecutor de migraciones: mejora pendiente (no se toca aquí).
- **Límite de peticiones simultáneas por IP** (`limiteSimultaneas.js`, Observatorio de biodiversidad): es por instancia; con N instancias el límite efectivo se multiplica por N.
- **`memoizar` de analítica** es por instancia (desfase aceptado de 30 s).
- **`/health`** (existente) consulta BD, Redis y almacenamiento y devuelve 503 si la BD cae: sirve para monitoreo, no como *liveness* de contenedor (use `/health/live`).
- **Redis caído con varias instancias:** el límite de tráfico vuelve a ser por instancia (degradación aceptada y avisada en el registro).
- **Purga del CDN** manual (sección 4).

## 11. Comprobaciones de solo lectura en el servidor del dueño

Nada de esto cambia el sistema. **No pegue en chats ni tickets la salida de `env` o de archivos `.env`**: contienen secretos; los comandos de abajo filtran solo los nombres que interesan.

```bash
# Recursos de la máquina
nproc; free -h; df -h; uptime

# Contenedores, uso de CPU/memoria y límites configurados
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker stats --no-stream
docker inspect -f '{{.Name}} memoria={{.HostConfig.Memory}} cpus={{.HostConfig.NanoCpus}}' $(docker ps -q)

# Variables de rendimiento del backend (solo estos nombres, sin valores secretos)
docker exec NOMBRE_DEL_BACKEND sh -c 'env | grep -E "^(UV_THREADPOOL_SIZE|DB_POOL_MAX|BIODIVERSIDAD_POOL_MAX|ANALITICA_COLA|CDN_CACHE_HEADERS|LOAD_SHEDDING)="'

# Salud
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4000/health/ready      # tras fusionar el PR de salud

# PostgreSQL (conexiones y límites)
psql -c "SHOW max_connections;" -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
psql -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

# Redis (memoria, expulsiones, aciertos)
redis-cli info memory | grep -E "used_memory_human|maxmemory_human|maxmemory_policy"
redis-cli info stats  | grep -E "evicted_keys|keyspace_hits|keyspace_misses"

# Conexiones de red abiertas
ss -s
```

Con estos datos se completa la tabla de la sección 3 (núcleos, memoria, `max_connections`) y se sabe cuánto margen real hay antes de decidir la etapa.
