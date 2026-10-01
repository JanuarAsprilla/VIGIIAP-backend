/**
 * Tests de integración — quitar la config de fichas de una capa.
 * La consulta `capa = ANY(capas_con_ficha)` contra la tabla real de geovisores
 * (con su CHECK de subconjunto) no se puede validar con mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import { upsertConfig, upsertFicha, eliminarConfig, obtenerConfig } from '../../src/modules/fichas/fichas.service.js';

const CAPA = 't_19_clima:estaciones';

let userId;
let conexionId;
let configId;

async function crearGeovisor(slug, titulo, { capasSeleccionadas, capasConFicha }) {
  const { rows } = await query(
    `INSERT INTO geovisores (slug, titulo, conexion_geoserver_id, centro_lat, centro_lng, capas_seleccionadas, capas_con_ficha)
     VALUES ($1, $2, $3, 5.5, -76.6, $4, $5) RETURNING id`,
    [slug, titulo, conexionId, capasSeleccionadas, capasConFicha],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanDatabase();
  const { rows: u } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin SIG', 'sig@iiap.test', '$2b$12$dummy', 'admin_sig', true, true)
    RETURNING id
  `);
  userId = u[0].id;

  const { rows: c } = await query(`
    INSERT INTO conexiones_geoserver (nombre, url, tipo)
    VALUES ('GeoServer de prueba', 'https://geoserver.test.local/geoserver', 'externo')
    RETURNING id
  `);
  conexionId = c[0].id;

  configId = (await upsertConfig({ conexionId, capaId: CAPA, campoIdentificador: 'codigo' }, userId)).id;
});

afterEach(async () => {
  // geovisores no tiene cascada hacia la conexión, y fichas_punto es ON DELETE RESTRICT
  // a propósito: se limpian en el orden que respeta ambas FK.
  await query('DELETE FROM geovisores WHERE conexion_geoserver_id = $1', [conexionId]);
  await query('DELETE FROM fichas_punto WHERE capa_config_id IN (SELECT id FROM capas_fichas_config WHERE conexion_geoserver_id = $1)', [conexionId]);
  await query('DELETE FROM conexiones_geoserver WHERE id = $1', [conexionId]);
});

describe('eliminarConfig() contra Postgres real', () => {
  it('borra la config cuando la capa no tiene fichas ni geovisores que la usen', async () => {
    await eliminarConfig(configId);

    expect(await obtenerConfig(conexionId, CAPA)).toBeNull();
  });

  it('se rehace de cero: tras quitarla se puede configurar otra vez con otro identificador', async () => {
    await eliminarConfig(configId);

    const nueva = await upsertConfig({ conexionId, capaId: CAPA, campoIdentificador: 'otro_campo' }, userId);

    expect(nueva.campoIdentificador).toBe('otro_campo');
  });

  it('409 CONFIG_CON_FICHAS si la capa ya tiene fichas, y la config se conserva', async () => {
    await upsertFicha(configId, 'EST-001', { descripcion: 'Texto' }, userId);

    await expect(eliminarConfig(configId)).rejects.toMatchObject({ status: 409, code: 'CONFIG_CON_FICHAS' });
    expect(await obtenerConfig(conexionId, CAPA)).not.toBeNull();
  });

  it('409 CONFIG_EN_USO mientras un geovisor exija fichas en la capa; libre en cuanto las quita', async () => {
    const geovisorId = await crearGeovisor('clima-choco', 'Clima del Chocó', { capasSeleccionadas: [CAPA], capasConFicha: [CAPA] });

    await expect(eliminarConfig(configId)).rejects.toMatchObject({
      status: 409,
      code: 'CONFIG_EN_USO',
      message: expect.stringContaining('Clima del Chocó'),
    });

    await query('UPDATE geovisores SET capas_con_ficha = $1 WHERE id = $2', [[], geovisorId]);
    await eliminarConfig(configId);

    expect(await obtenerConfig(conexionId, CAPA)).toBeNull();
  });

  it('un geovisor que muestra la capa sin exigir fichas no bloquea el borrado', async () => {
    await crearGeovisor('clima-simple', 'Clima simple', { capasSeleccionadas: [CAPA], capasConFicha: [] });

    await eliminarConfig(configId);

    expect(await obtenerConfig(conexionId, CAPA)).toBeNull();
  });

  it('un geovisor que exige fichas en OTRA capa no bloquea el borrado', async () => {
    await crearGeovisor('otra-capa', 'Otra capa', { capasSeleccionadas: ['t_19_clima:rios'], capasConFicha: ['t_19_clima:rios'] });

    await eliminarConfig(configId);

    expect(await obtenerConfig(conexionId, CAPA)).toBeNull();
  });
});
