/**
 * Tests de integración — embudos de conversión y flujo de navegación (Postgres real).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { getEmbudos, getFlujoNavegacion } from '../../src/modules/analitica/analitica.service.js';

const idSesion = (n) => `00000000-0000-4000-8000-00000000030${n}`;
const ventana = () => ({ desde: new Date(Date.now() - 86_400_000), hasta: new Date(Date.now() + 86_400_000) });

async function sesion(n, { bot = false } = {}) {
  await query(
    `INSERT INTO analytics_sessions (id, dispositivo, es_bot) VALUES ($1, 'escritorio', $2)`,
    [idSesion(n), bot],
  );
}

/** Página vista `segundos` después del inicio de la prueba (para fijar el orden). */
async function vista(n, ruta, segundos, { admin = false } = {}) {
  await query(
    `INSERT INTO analytics_pageviews (session_id, ruta, es_entrada, es_area_admin, creado_en)
     VALUES ($1, $2, false, $3, NOW() - INTERVAL '1 hour' + make_interval(secs => $4))`,
    [idSesion(n), ruta, admin, segundos],
  );
}

async function accion(n, nombre, segundos) {
  await query(
    `INSERT INTO analytics_eventos (session_id, nombre, creado_en) VALUES ($1, $2, NOW() - INTERVAL '1 hour' + make_interval(secs => $3))`,
    [idSesion(n), nombre, segundos],
  );
}

const embudoMapas = async () => (await getEmbudos(ventana())).find((e) => e.id === 'mapas');

beforeEach(async () => {
  await query('TRUNCATE TABLE analytics_sessions CASCADE');
});

describe('embudos', () => {
  it('cuenta en cada paso solo las sesiones que pasaron por los anteriores, en orden', async () => {
    // 1: recorrido completo; 2: se queda en Mapas; 3: solo portada
    await sesion(1); await vista(1, '/', 0); await vista(1, '/mapas', 10); await accion(1, 'descarga_mapa', 20);
    await sesion(2); await vista(2, '/', 0); await vista(2, '/mapas', 10);
    await sesion(3); await vista(3, '/', 0);

    const { pasos } = await embudoMapas();

    expect(pasos.map((p) => p.sesiones)).toEqual([3, 2, 1]);
    expect(pasos[1]).toMatchObject({ pctDelAnterior: 67, pctDelInicio: 67 });
    expect(pasos[2]).toMatchObject({ pctDelAnterior: 50, pctDelInicio: 33 });
  });

  it('una descarga anterior a la visita a Mapas no cuenta: el orden importa', async () => {
    await sesion(4);
    await vista(4, '/', 0);
    await accion(4, 'descarga_mapa', 5);
    await vista(4, '/mapas', 10);

    const { pasos } = await embudoMapas();

    expect(pasos.map((p) => p.sesiones)).toEqual([1, 1, 0]);
  });

  it('excluye bots y las visitas al panel de administración', async () => {
    await sesion(5, { bot: true });
    await vista(5, '/', 0); await vista(5, '/mapas', 10); await accion(5, 'descarga_mapa', 20);
    await sesion(6);
    await vista(6, '/', 0, { admin: true });

    const { pasos } = await embudoMapas();

    expect(pasos.map((p) => p.sesiones)).toEqual([0, 0, 0]);
  });
});

describe('flujo de navegación', () => {
  it('cuenta los pasos consecutivos entre páginas distintas, sin bots ni administración', async () => {
    await sesion(7); await vista(7, '/', 0); await vista(7, '/mapas', 10); await vista(7, '/documentos', 20);
    await sesion(8); await vista(8, '/', 0); await vista(8, '/mapas', 10); await vista(8, '/mapas', 12);
    await sesion(9, { bot: true }); await vista(9, '/', 0); await vista(9, '/mapas', 10);

    const flujo = await getFlujoNavegacion(ventana());

    expect(flujo[0]).toEqual({ desde: '/', hacia: '/mapas', veces: 2 });
    expect(flujo).toContainEqual({ desde: '/mapas', hacia: '/documentos', veces: 1 });
    expect(flujo.find((f) => f.desde === '/mapas' && f.hacia === '/mapas')).toBeUndefined();
  });
});
