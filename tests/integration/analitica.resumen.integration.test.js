/**
 * Tests de integración — resumen de analítica agregado en SQL (Postgres real).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { getResumen } from '../../src/modules/analitica/analitica.service.js';

const idSesion = (n) => `00000000-0000-4000-8000-00000000020${n}`;

async function sesion(n, { bot = false, primeraVisita = 'NOW()' } = {}) {
  await query(
    `INSERT INTO analytics_sessions (id, dispositivo, es_bot, primera_visita_en, ultima_actividad_en)
     VALUES ($1, 'escritorio', $2, ${primeraVisita}, ${primeraVisita})`,
    [idSesion(n), bot],
  );
}

async function vista(n, creadoEn = 'NOW()') {
  await query(
    `INSERT INTO analytics_pageviews (session_id, ruta, es_entrada, es_area_admin, creado_en)
     VALUES ($1, '/mapas', false, false, ${creadoEn})`,
    [idSesion(n)],
  );
}

// 00:00 de hoy en Bogotá, como instante UTC
const INICIO_HOY = `(date_trunc('day', NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`;

beforeEach(async () => {
  await query('TRUNCATE TABLE analytics_sessions CASCADE');
});

describe('getResumen() con SQL real', () => {
  it('cuenta vistas y visitantes por día de Bogotá y excluye bots', async () => {
    await sesion(1);
    await sesion(2);
    await sesion(3, { bot: true });
    await vista(1);
    await vista(1);
    await vista(2);
    await vista(3);

    const resumen = await getResumen();

    expect(resumen.paginasVistas.serie7.at(-1)).toBe(3);
    expect(resumen.visitantes.serie7.at(-1)).toBe(2);
    expect(resumen.paginasVistas.semanaActual).toBe(3);
  });

  it('el día cambia a medianoche de Bogotá, no a la del servidor', async () => {
    await sesion(4);
    await vista(4, `${INICIO_HOY} - INTERVAL '1 minute'`);
    await vista(4, `LEAST(${INICIO_HOY} + INTERVAL '1 hour', NOW())`);

    const { paginasVistas } = await getResumen();

    expect(paginasVistas.serie7.at(-1)).toBe(1);
    expect(paginasVistas.serie7.at(-2)).toBe(1);
  });

  it('tasa de rebote y duración siguen calculándose en la base', async () => {
    await sesion(5);
    await sesion(6);
    await vista(5);
    await vista(6);
    await vista(6, `NOW() + INTERVAL '30 seconds'`);

    const resumen = await getResumen();

    expect(resumen.tasaRebotePct).toBe(50);
    expect(resumen.duracionPromedioSeg).toBeGreaterThanOrEqual(15);
  });
});
