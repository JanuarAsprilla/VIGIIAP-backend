# Pruebas de carga

Herramienta sin dependencias externas (solo Node 20 o superior). Lanza trabajadores concurrentes que piden rutas ponderadas durante una duración fija y muestra latencias por ruta. Termina con código 1 si se incumple un umbral, por lo que sirve en CI.

```bash
node loadtest/carga.mjs --url http://localhost:3000 --duracion 30 --concurrencia 20
```

| Opción | Por defecto | Descripción |
|---|---|---|
| `--url` | `http://localhost:3000` | Base del servidor a medir |
| `--escenario` | `publico` | `publico` (navegación general) o `busqueda` (consultas con `q`) |
| `--duracion` | `20` | Segundos |
| `--concurrencia` | `10` | Trabajadores simultáneos |
| `--umbral-p95` | `500` | Milisegundos máximos del p95 global |
| `--umbral-error` | `0.01` | Tasa máxima de errores (5xx y fallos de red) |

## Cómo usarlo bien

1. **Entorno propio.** Nunca contra producción: mide la capacidad del servicio y compite con usuarios reales.
2. **Eleva el límite de tasa del entorno de prueba** (`RATE_LIMIT_MAX`). Con una sola IP el limitador responde `429` casi de inmediato y mide el limitador, no el servicio. El resumen cuenta los `429` aparte y avisa cuando aparecen.
3. **Compara en pares.** Ejecuta con y sin Redis, o antes y después de un cambio, con los mismos datos y parámetros.
4. **Usa datos del tamaño real.** Una base casi vacía hace que todo parezca rápido.

## Resultado de ejemplo

```
ruta                                       total      rps    p50    p95    p99    429  error
/api/v1/mapas?page=1&limit=12              25761   1287.9      4      8     13      0      0
...
TOTAL                                     108875   5443.1      3      7     11      0      0

APROBADO
```

Las mediciones de referencia y su interpretación están en [`docs/ESTRATEGIA_RENDIMIENTO.md`](../docs/ESTRATEGIA_RENDIMIENTO.md).

## Añadir un escenario

Agrega una entrada a `ESCENARIOS` en `carga.mjs` con rutas `GET` y su peso relativo. La lógica estadística (percentiles, umbrales, selección ponderada) vive en `estadisticas.mjs` y tiene pruebas en `tests/loadtest.estadisticas.test.js`.
