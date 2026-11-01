/**
 * Tests de integración — comparación con el período anterior (Postgres real).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { getComparativa } from '../../src/modules/analitica/analitica.service.js';

const DIA = 86_400_000;
const idSesion = (n) => `00000000-0000-4000-8000-00000000040${n}`;

// Rango de prueba: los últimos 7 días; el anterior son los 7 días previos.
const hasta = new Date();
const desde = new Date(hasta.getTime() - 7 * DIA);
const haceDias = (dias) => new Date(hasta.getTime() - dias * DIA).toISOString();

async function sesion(n, { bot = false } = {}) {
  await query(`INSERT INTO analytics_sessions (id, dispositivo, es_bot) VALUES ($1, 'escritorio', $2)`, [idSesion(n), bot]);
}
const vista = (n, dias, { admin = false } = {}) => query(
  `INSERT INTO analytics_pageviews (session_id, ruta, es_entrada, es_area_admin, creado_en) VALUES ($1, '/mapas', false, $2, $3)`,
  [idSesion(n), admin, haceDias(dias)],
);
const accion = (n, dias) => query(
  `INSERT INTO analytics_eventos (session_id, nombre, creado_en) VALUES ($1, 'descarga_mapa', $2)`,
  [idSesion(n), haceDias(dias)],
);

beforeEach(async () => {
  await query('TRUNCATE TABLE analytics_sessions CASCADE');
});

describe('getComparativa() con SQL real', () => {
  it('separa el rango actual del anterior y calcula la variación', async () => {
    // Actual (últimos 7 días): sesión 1 con 3 vistas, sesión 2 con 1 vista (rebote), 2 acciones
    await sesion(1); await vista(1, 1); await vista(1, 2); await vista(1, 3); await accion(1, 1);
    await sesion(2); await vista(2, 2); await accion(2, 2);
    // Anterior (7 a 14 días atrás): sesión 3 con 2 vistas, 1 acción
    await sesion(3); await vista(3, 9); await vista(3, 10); await accion(3, 9);

    const { actual, anterior, variacion } = await getComparativa({ desde, hasta });

    expect(actual).toMatchObject({ vistas: 4, sesiones: 2, acciones: 2, rebotePct: 50 });
    expect(anterior).toMatchObject({ vistas: 2, sesiones: 1, acciones: 1, rebotePct: 0 });
    expect(variacion).toEqual({ vistas: 100, sesiones: 100, acciones: 100, rebotePuntos: 50 });
  });

  it('excluye bots y la actividad del panel de administración', async () => {
    await sesion(4, { bot: true }); await vista(4, 1); await accion(4, 1);
    await sesion(5); await vista(5, 1, { admin: true });

    const { actual } = await getComparativa({ desde, hasta });

    expect(actual).toMatchObject({ vistas: 0, sesiones: 0, acciones: 0 });
  });

  it('una vista fuera de ambos períodos no cuenta en ninguno', async () => {
    await sesion(6); await vista(6, 30);

    const { actual, anterior } = await getComparativa({ desde, hasta });

    expect(actual.vistas).toBe(0);
    expect(anterior.vistas).toBe(0);
  });
});
