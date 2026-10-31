/**
 * Tests de integración — eventos personalizados y tiempo real de la analítica (Postgres real).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import {
  registrarPageview, registrarEvento, getEventosTop, getTiempoReal,
} from '../../src/modules/analitica/analitica.service.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const idSesion = (n) => `00000000-0000-4000-8000-00000000010${n}`;

const pageview = (n, extra = {}) => registrarPageview({
  sessionId: idSesion(n), ruta: '/mapas', titulo: 'Mapas', dispositivo: 'escritorio',
  navegador: 'Chrome', sistemaOperativo: 'Windows', esAreaAdmin: false, userAgent: UA, ...extra,
});

const ventana = () => ({ desde: new Date(Date.now() - 86_400_000), hasta: new Date(Date.now() + 86_400_000) });

beforeEach(async () => {
  await query('TRUNCATE TABLE analytics_sessions CASCADE');
});

describe('eventos', () => {
  it('guarda eventos de sesiones reales y los agrega por nombre y recurso', async () => {
    await pageview(1);
    await pageview(2);
    await registrarEvento({ sessionId: idSesion(1), nombre: 'descarga_mapa', recurso: 'rio-atrato' });
    await registrarEvento({ sessionId: idSesion(1), nombre: 'descarga_mapa', recurso: 'rio-atrato' });
    await registrarEvento({ sessionId: idSesion(2), nombre: 'descarga_mapa', recurso: 'rio-baudo' });
    await registrarEvento({ sessionId: idSesion(2), nombre: 'abrir_geovisor', recurso: 'bosques' });

    const { eventos, recursos } = await getEventosTop(ventana());

    expect(eventos).toEqual([
      { nombre: 'descarga_mapa', total: 3, sesiones: 2 },
      { nombre: 'abrir_geovisor', total: 1, sesiones: 1 },
    ]);
    expect(recursos[0]).toEqual({ nombre: 'descarga_mapa', recurso: 'rio-atrato', total: 2 });
  });

  it('descarta eventos de sesiones inexistentes y de bots', async () => {
    await pageview(3, { userAgent: 'Googlebot/2.1' });

    expect(await registrarEvento({ sessionId: idSesion(4), nombre: 'buscar' })).toBe(false);
    expect(await registrarEvento({ sessionId: idSesion(3), nombre: 'buscar' })).toBe(false);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM analytics_eventos');
    expect(rows[0].n).toBe(0);
  });

  it('los eventos se borran junto con su sesión', async () => {
    await pageview(5);
    await registrarEvento({ sessionId: idSesion(5), nombre: 'compartir' });

    await query('DELETE FROM analytics_sessions WHERE id = $1', [idSesion(5)]);

    const { rows } = await query('SELECT COUNT(*)::int AS n FROM analytics_eventos');
    expect(rows[0].n).toBe(0);
  });
});

describe('tiempo real', () => {
  it('cuenta solo las sesiones activas y no bots, con su página actual', async () => {
    await pageview(6, { ruta: '/mapas' });
    await pageview(7, { ruta: '/mapas' });
    await pageview(8, { ruta: '/documentos' });
    await pageview(9, { userAgent: 'Googlebot/2.1' });
    await query(
      `UPDATE analytics_sessions SET ultima_actividad_en = NOW() - INTERVAL '30 minutes' WHERE id = $1`,
      [idSesion(8)],
    );

    const vivo = await getTiempoReal();

    expect(vivo.visitantesActivos).toBe(2);
    expect(vivo.paginasActuales).toEqual([{ ruta: '/mapas', visitantes: 2 }]);
  });
});
