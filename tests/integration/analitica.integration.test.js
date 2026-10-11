/**
 * Tests de integración — ubicación e IP en la analítica y su purga (Postgres real).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { registrarPageview, getUbicaciones, getSesionesRecientes } from '../../src/modules/analitica/analitica.service.js';
import { purgarAnalitica } from '../../src/utils/retencionDatos.js';
import { definirProveedorUbicacion } from '../../src/utils/geolocalizacion.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const idSesion = (n) => `00000000-0000-4000-8000-00000000000${n}`;

const pageview = (n, extra = {}) => registrarPageview({
  sessionId: idSesion(n), ruta: '/', titulo: 'Inicio', dispositivo: 'escritorio',
  navegador: 'Chrome', sistemaOperativo: 'Windows', esAreaAdmin: false, userAgent: UA, ...extra,
});

const ahora = () => ({ desde: new Date(Date.now() - 86_400_000), hasta: new Date(Date.now() + 86_400_000) });

beforeEach(async () => {
  await query('TRUNCATE TABLE analytics_sessions CASCADE');
  definirProveedorUbicacion((ip) => (ip === '181.49.10.10'
    ? { country: 'CO', region: 'CHO', city: 'Quibdó' }
    : { country: 'US', region: 'TX', city: 'Austin' }));
});
afterEach(() => definirProveedorUbicacion(undefined));

describe('registro de la sesión', () => {
  it('guarda IP y ubicación en la sesión nueva', async () => {
    await pageview(1, { ip: '181.49.10.10' });

    const { rows } = await query('SELECT ip, pais, departamento, ciudad FROM analytics_sessions');
    expect(rows).toEqual([{ ip: '181.49.10.10', pais: 'CO', departamento: 'Chocó', ciudad: 'Quibdó' }]);
  });

  it('los bots no guardan IP', async () => {
    await pageview(2, { ip: '66.249.1.1', userAgent: 'Googlebot/2.1' });

    const { rows } = await query('SELECT ip, pais, es_bot FROM analytics_sessions');
    expect(rows).toEqual([{ ip: null, pais: null, es_bot: true }]);
  });
});

describe('consultas', () => {
  beforeEach(async () => {
    await pageview(1, { ip: '181.49.10.10' });
    await pageview(2, { ip: '181.49.10.10' });
    await pageview(3, { ip: '8.8.8.8' });
    await pageview(4);
  });

  it('agrupa las sesiones por país y departamento', async () => {
    const r = await getUbicaciones(ahora());

    expect(r.paises).toEqual([{ pais: 'CO', sesiones: 2 }, { pais: 'US', sesiones: 1 }]);
    expect(r.departamentos).toEqual([{ departamento: 'Chocó', sesiones: 2 }]);
    expect(r.sinUbicacion).toBe(1);
  });

  it('lista las sesiones recientes con su IP', async () => {
    const filas = await getSesionesRecientes({ limit: 10 });

    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f.ip).filter(Boolean).sort()).toEqual(['181.49.10.10', '181.49.10.10', '8.8.8.8']);
  });
});

describe('retención', () => {
  it('borra la IP de las sesiones viejas, conserva la ubicación y elimina las muy antiguas', async () => {
    await pageview(1, { ip: '181.49.10.10' });
    await pageview(2, { ip: '181.49.10.10' });
    await pageview(3, { ip: '181.49.10.10' });
    await query(`UPDATE analytics_sessions SET primera_visita_en = NOW() - INTERVAL '100 days' WHERE id = $1`, [idSesion(2)]);
    await query(`UPDATE analytics_sessions SET primera_visita_en = NOW() - INTERVAL '800 days' WHERE id = $1`, [idSesion(3)]);

    const r = await purgarAnalitica();

    expect(r).toEqual({ ipsBorradas: 2, sesionesBorradas: 1 });
    const { rows } = await query('SELECT id, ip, departamento FROM analytics_sessions ORDER BY id');
    expect(rows).toEqual([
      { id: idSesion(1), ip: '181.49.10.10', departamento: 'Chocó' },
      { id: idSesion(2), ip: null, departamento: 'Chocó' },
    ]);
  });
});
