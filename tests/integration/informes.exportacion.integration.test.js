/**
 * Exportación de registros de Biodiversidad (Excel y CSV) contra PostgreSQL real: quién puede, el tope de filas, las coordenadas
 * ocultas, los filtros y la auditoría. El permiso lo decide el servidor, no el botón.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../src/config/database.js';
import { registrosParaExportar } from '../../src/modules/biodiversidad/biodiversidad.service.js';
import { sembrar, limpiar, REGISTROS, idsDe } from './helpers/biodiversidad_semilla.js';

const { default: app } = await import('../../src/app.js');

const RUTA = '/api/v1/informes/biodiversidad/registros';
const COLUMNAS = [
  'anio', 'conjunto', 'coordenadas_ocultas', 'departamento', 'doi_conjunto', 'endemica_choco', 'endemica_colombia', 'especie', 'fecha_evento',
  'gbif_id', 'identificado_por', 'incertidumbre_m', 'introducida', 'invasora', 'latitud', 'licencia', 'longitud', 'municipio', 'amenaza',
  'registrado_por', 'tipo_evidencia',
].sort();

let usuarioId;
let token;
let contador = 0;

const firmar = (carga) => jwt.sign(carga, process.env.JWT_SECRET, { expiresIn: '15m', algorithm: 'HS256' });
const ip = () => `10.99.${Math.floor(++contador / 250)}.${(contador % 250) + 1}`;
const pedir = (consulta = { grupo: 'anfibios' }, portador = token) => {
  let r = request(app).get(RUTA).set('X-Forwarded-For', ip()).query(consulta);
  if (portador) r = r.set('Authorization', `Bearer ${portador}`);
  return r;
};

/** Deja la configuración de Informes como la de fábrica: otros archivos de prueba la tocan y no siempre la restablecen. */
async function restablecerConfiguracion() {
  await query(`UPDATE informes_config SET acceso = 'usuarios', formatos = ARRAY['pdf', 'xlsx'] WHERE id = 1`);
  await query(`UPDATE herramientas SET activa = true, deleted_at = NULL WHERE clave = 'biodiversidad'`);
  await query(
    `INSERT INTO informes_herramienta (herramienta, activo, formatos, max_filas) VALUES ('biodiversidad', true, NULL, 5000)
     ON CONFLICT (herramienta) DO UPDATE SET activo = true, formatos = NULL, max_filas = 5000`,
  );
}

beforeAll(async () => {
  await restablecerConfiguracion();
  await limpiar();
  await sembrar();
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
     VALUES ('Ana', 'exporta@iiap.test', 'x', 'investigador', true, true) RETURNING id`,
  );
  usuarioId = rows[0].id;
  token = firmar({ id: usuarioId, email: 'exporta@iiap.test', rol: 'investigador' });
});

afterAll(async () => {
  await limpiar();
  await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioId]);
});

afterEach(restablecerConfiguracion);

describe('quién puede exportar', () => {
  it('por defecto solo con cuenta: anónimos y visitantes reciben 401 y no se toca la base', async () => {
    expect((await pedir(undefined, null)).status).toBe(401);
    const visitante = firmar({ visitanteId: 'v-1', rol: 'visitante', tipo: 'visitante' });
    const r = await pedir(undefined, visitante);
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Inicia sesión/);
    expect(r.body.registros).toBeUndefined();
  });

  it('con una cuenta entrega los registros', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ grupo: 'anfibios', limite: 5000, truncado: false });
  });

  it('si el administrador abre la descarga a cualquiera, un anónimo también puede', async () => {
    await query(`UPDATE informes_config SET acceso = 'publico' WHERE id = 1`);
    const r = await pedir(undefined, null);
    expect(r.status).toBe(200);
    expect(r.body.registros.length).toBeGreaterThan(0);
  });

  it('con el informe apagado, la herramienta oculta o sin formatos de datos, no hay descarga', async () => {
    await query(`UPDATE informes_herramienta SET activo = false WHERE herramienta = 'biodiversidad'`);
    expect((await pedir()).status).toBe(404);
    await query(`UPDATE informes_herramienta SET activo = true, formatos = ARRAY['pdf'] WHERE herramienta = 'biodiversidad'`);
    const soloPdf = await pedir();
    expect(soloPdf.status).toBe(403);
    expect(soloPdf.body.error).toMatch(/descarga de datos/);
    await query(`UPDATE informes_herramienta SET formatos = NULL WHERE herramienta = 'biodiversidad'`);
    await query(`UPDATE herramientas SET activa = false WHERE clave = 'biodiversidad'`);
    expect((await pedir()).status).toBe(404);
  });
});

describe('qué entrega', () => {
  it('todos los registros del grupo, una vez cada uno, del año más reciente al más antiguo, sin fotos ni columnas internas', async () => {
    const { registros } = (await pedir()).body;
    expect(registros.map((r) => r.gbif_id)).toEqual(['g8', 'g6', 'g2', 'g4', 'g1', 'g7', 'g3', 'g5']);
    expect([...registros.map((r) => r.gbif_id)].sort()).toEqual(idsDe(REGISTROS));
    for (const fila of registros) expect(Object.keys(fila).sort()).toEqual(COLUMNAS);
  });

  it('las coordenadas ocultas siguen ocultas: la exportación no revela lo que el listado no muestra', async () => {
    const { registros } = (await pedir()).body;
    for (const fila of registros) {
      const origen = REGISTROS.find((r) => r.id === fila.gbif_id);
      if (origen.oculto) {
        expect(fila.coordenadas_ocultas).toBe(true);
        expect(fila.latitud).toBeNull();
        expect(fila.longitud).toBeNull();
      } else {
        expect(Number(fila.latitud)).toBeCloseTo(origen.lat, 2);
      }
    }
  });

  it('respeta los filtros del tablero', async () => {
    const r = await pedir({ grupo: 'anfibios', departamento: 'Antioquia' });
    expect(r.body.registros.map((f) => f.gbif_id).sort()).toEqual(['g3', 'g6']);
    expect((await pedir({ grupo: 'anfibios', familia: 'Bufonidae' })).body.registros.map((f) => f.gbif_id).sort()).toEqual(['g2', 'g3', 'g4']);
  });
});

describe('qué rechaza', () => {
  it('parámetros de ordenar o paginar y filtros desconocidos (422), como el resto de la API', async () => {
    for (const mala of [{ pagina: '2' }, { tamano: '5' }, { orden: 'especie' }, { columna_interna: 'x' }, { grupo: 'dinosaurios' }]) {
      const r = await pedir({ grupo: 'anfibios', ...mala });
      expect(r.status, JSON.stringify(mala)).toBe(422);
    }
    expect((await pedir({})).status).toBe(422);
  });

  it('un grupo solo agregado (422) y uno sin datos (404)', async () => {
    const agregado = await pedir({ grupo: 'aves' });
    expect(agregado.status).toBe(422);
    expect(agregado.body.error).toMatch(/agregado/);
    expect((await pedir({ grupo: 'hongos' })).status).toBe(404);
  });
});

describe('tope de filas', () => {
  it('trae una fila de más para saber si hubo recorte y entrega solo hasta el tope', async () => {
    const corto = await registrosParaExportar({ grupo: 'anfibios' }, 3);
    expect(corto.truncado).toBe(true);
    expect(corto.limite).toBe(3);
    expect(corto.registros.map((r) => r.gbif_id)).toEqual(['g8', 'g6', 'g2']);
    const justo = await registrosParaExportar({ grupo: 'anfibios' }, 8);
    expect(justo.truncado).toBe(false);
    expect(justo.registros).toHaveLength(8);
    expect((await registrosParaExportar({ grupo: 'anfibios' }, 100)).truncado).toBe(false);
  });

  it('un grupo sin lote devuelve null y uno agregado lanza el error de la consulta', async () => {
    expect(await registrosParaExportar({ grupo: 'hongos' }, 10)).toBeNull();
    await expect(registrosParaExportar({ grupo: 'aves' }, 10)).rejects.toThrow(/agregado/);
  });
});

describe('rastro', () => {
  it('cada descarga queda en la auditoría con quién, qué y cuántos registros', async () => {
    // La auditoría es de solo anexar: no se limpia, se cuenta antes y después.
    const contar = async () => (await query(`SELECT count(*)::int AS n FROM audit_log WHERE accion = 'informe_registros'`)).rows[0].n;
    const antes = await contar();
    expect((await pedir()).status).toBe(200);
    await expect.poll(contar, { timeout: 5000 }).toBe(antes + 1);
    const { rows } = await query(`SELECT * FROM audit_log WHERE accion = 'informe_registros' ORDER BY secuencia DESC LIMIT 1`);
    expect(rows[0]).toMatchObject({ modulo: 'informes', entidad_id: 'biodiversidad', usuario_id: usuarioId });
    expect(rows[0].descripcion).toMatch(/anfibios: 8/);
  });
});
