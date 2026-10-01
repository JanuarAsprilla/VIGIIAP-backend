/**
 * Tests de integración — importación en lote de fichas por punto.
 * La sentencia INSERT ... SELECT unnest(...) ON CONFLICT no se puede validar
 * con mocks: acá corre contra Postgres real.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import { upsertConfig, importarFichas, obtenerFicha, upsertFicha } from '../../src/modules/fichas/fichas.service.js';

let userId;
let conexionId;
let configId;

const fila = (valor, descripcion = 'Descripción de más de veinte caracteres', titulo) => ({ valor, descripcion, ...(titulo ? { titulo } : {}) });

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

  const config = await upsertConfig({ conexionId, capaId: 't_19_clima:estaciones', campoIdentificador: 'codigo' }, userId);
  configId = config.id;
});

afterEach(async () => {
  // fichas_punto.capa_config_id es ON DELETE RESTRICT a propósito (protege el
  // contenido curado), así que se borran primero las fichas; la conexión se
  // lleva la config en cascada. cleanDatabase() no toca conexiones_geoserver.
  await query('DELETE FROM fichas_punto WHERE capa_config_id = $1', [configId]);
  await query('DELETE FROM conexiones_geoserver WHERE id = $1', [conexionId]);
});

describe('importarFichas() contra Postgres real', () => {
  it('crea las fichas nuevas y se pueden leer de vuelta con título y descripción', async () => {
    const r = await importarFichas(configId, {
      filas: [fila('EST-001', 'Estación del río Atrato, monitorea el nivel', 'Quibdó'), fila('EST-002')],
      sobrescribir: false,
    }, userId);

    expect(r).toEqual({ creadas: 2, actualizadas: 0, omitidas: 0, duplicadasEnArchivo: 0 });
    const ficha = await obtenerFicha(configId, 'EST-001');
    expect(ficha).toMatchObject({ titulo: 'Quibdó', descripcion: 'Estación del río Atrato, monitorea el nivel' });
    expect((await obtenerFicha(configId, 'EST-002')).titulo).toBeNull();
  });

  it('sin sobrescribir no pisa una ficha con descripción, pero sí completa una que estaba vacía', async () => {
    await upsertFicha(configId, 'EST-001', { descripcion: 'Escrita a mano por el equipo' }, userId);
    await upsertFicha(configId, 'EST-002', { descripcion: '' }, userId);

    const r = await importarFichas(configId, {
      filas: [fila('EST-001', 'Texto del Excel que no debe entrar'), fila('EST-002', 'Texto del Excel que sí entra')],
      sobrescribir: false,
    }, userId);

    expect(r).toMatchObject({ creadas: 0, actualizadas: 1, omitidas: 1 });
    expect((await obtenerFicha(configId, 'EST-001')).descripcion).toBe('Escrita a mano por el equipo');
    expect((await obtenerFicha(configId, 'EST-002')).descripcion).toBe('Texto del Excel que sí entra');
  });

  it('con sobrescribir reemplaza la descripción, y un título vacío conserva el que ya tenía', async () => {
    await upsertFicha(configId, 'EST-001', { titulo: 'Título previo', descripcion: 'Descripción previa del equipo' }, userId);

    await importarFichas(configId, { filas: [fila('EST-001', 'Descripción nueva desde el Excel')], sobrescribir: true }, userId);

    expect(await obtenerFicha(configId, 'EST-001')).toMatchObject({
      titulo: 'Título previo',
      descripcion: 'Descripción nueva desde el Excel',
    });
  });

  it('guarda tal cual valores y textos con comillas, comas, saltos de línea y tildes', async () => {
    const valor = `EST "7", norte; ñandú`;
    const descripcion = 'Línea uno\nLínea dos, con "comillas" y \'apóstrofos\' — ñ';

    await importarFichas(configId, { filas: [fila(valor, descripcion, 'Título: ¿ok?')], sobrescribir: false }, userId);

    expect(await obtenerFicha(configId, valor)).toMatchObject({ titulo: 'Título: ¿ok?', descripcion });
  });

  it('una tanda completa de 500 filas entra en una sola sentencia', async () => {
    const filas = Array.from({ length: 500 }, (_, i) => fila(`EST-${String(i).padStart(3, '0')}`));

    const r = await importarFichas(configId, { filas, sobrescribir: false }, userId);

    expect(r.creadas).toBe(500);
    const { rows } = await query('SELECT COUNT(*) FROM fichas_punto WHERE capa_config_id = $1', [configId]);
    expect(Number(rows[0].count)).toBe(500);
  });

  it('importar dos veces el mismo archivo es idempotente: la segunda vez todo se omite', async () => {
    const filas = [fila('EST-001'), fila('EST-002')];
    await importarFichas(configId, { filas, sobrescribir: false }, userId);

    const r = await importarFichas(configId, { filas, sobrescribir: false }, userId);

    expect(r).toEqual({ creadas: 0, actualizadas: 0, omitidas: 2, duplicadasEnArchivo: 0 });
    const { rows } = await query('SELECT COUNT(*) FROM fichas_punto WHERE capa_config_id = $1', [configId]);
    expect(Number(rows[0].count)).toBe(2);
  });
});
