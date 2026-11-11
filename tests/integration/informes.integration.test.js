/**
 * Tests de integración — informes descargables contra PostgreSQL real: migración 071 (valores por defecto,
 * restricciones y permiso del módulo), quién puede descargar y la configuración que lee el botón.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import * as informes from '../../src/modules/informes/informes.service.js';

const CUENTA = { id: 'u-1', rol: 'investigador' };
const VISITANTE = { id: 'v-1', rol: 'visitante' };

beforeEach(async () => {
  await query(
    `UPDATE informes_config SET institucion = 'Vigía · IIAP', subtitulo = NULL, pie = NULL, aviso = NULL,
       color_primario = '#009846', color_acento = '#0F172A', logo_url = NULL, acceso = 'usuarios',
       formatos = ARRAY['pdf', 'xlsx'] WHERE id = 1`,
  );
  await query(`UPDATE herramientas SET activa = true, deleted_at = NULL WHERE clave = 'biodiversidad'`);
  await query(`DELETE FROM informes_herramienta`);
  await query(`INSERT INTO informes_herramienta (herramienta) VALUES ('biodiversidad')`);
});

describe('migración 071', () => {
  it('por defecto solo descargan las cuentas con sesión y se ofrecen PDF y Excel', async () => {
    const general = await informes.obtenerGeneral();
    expect(general.acceso).toBe('usuarios');
    expect(general.formatos).toEqual(['pdf', 'xlsx']);
    expect(general.logo_url).toBeNull();
  });

  it('rechaza formatos desconocidos, listas vacías y colores mal formados', async () => {
    await expect(query(`UPDATE informes_config SET formatos = ARRAY['doc'] WHERE id = 1`)).rejects.toThrow();
    await expect(query(`UPDATE informes_config SET formatos = ARRAY[]::text[] WHERE id = 1`)).rejects.toThrow();
    await expect(query(`UPDATE informes_config SET color_primario = 'verde' WHERE id = 1`)).rejects.toThrow();
    await expect(query(`UPDATE informes_config SET acceso = 'todos' WHERE id = 1`)).rejects.toThrow();
  });

  it('solo existe una fila de configuración general', async () => {
    await expect(query(`INSERT INTO informes_config (id) VALUES (2)`)).rejects.toThrow();
  });

  it('el módulo «informes» se puede asignar a un administrador', async () => {
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
       VALUES ('Admin', 'admin-informes@example.com', 'x', 'admin_sig', true, true) RETURNING id`,
    );
    await expect(query(
      `INSERT INTO admin_permisos_modulo (usuario_id, modulo, puede_ver, puede_editar) VALUES ($1, 'informes', true, true)`,
      [rows[0].id],
    )).resolves.toBeTruthy();
  });
});

describe('configuracionPublica', () => {
  it('con sesión de cuenta puede descargar', async () => {
    const c = await informes.configuracionPublica('biodiversidad', CUENTA);
    expect(c).toMatchObject({ habilitado: true, puedeDescargar: true, requiereSesion: true, formatos: ['pdf', 'xlsx'], maxFilas: 5000 });
  });

  it('sin cuenta (anónimo o visitante) no puede descargar por defecto, pero el botón sabe por qué', async () => {
    for (const quien of [null, VISITANTE]) {
      const c = await informes.configuracionPublica('biodiversidad', quien);
      expect(c.habilitado).toBe(true);
      expect(c.puedeDescargar).toBe(false);
      expect(c.requiereSesion).toBe(true);
    }
  });

  it('con acceso público también descarga un visitante', async () => {
    await informes.actualizarGeneral({ acceso: 'publico' });
    const c = await informes.configuracionPublica('biodiversidad', null);
    expect(c).toMatchObject({ puedeDescargar: true, requiereSesion: false });
  });

  it('apagado el informe de la herramienta nadie descarga y no ofrece formatos', async () => {
    await informes.actualizarHerramienta('biodiversidad', { activo: false });
    const c = await informes.configuracionPublica('biodiversidad', CUENTA);
    expect(c).toMatchObject({ habilitado: false, puedeDescargar: false, formatos: [] });
  });

  it('los formatos de la herramienta mandan sobre los generales', async () => {
    await informes.actualizarHerramienta('biodiversidad', { formatos: ['pdf'], max_filas: 1000 });
    const c = await informes.configuracionPublica('biodiversidad', CUENTA);
    expect(c.formatos).toEqual(['pdf']);
    expect(c.maxFilas).toBe(1000);
  });

  it('una herramienta sin ajustes de informe queda deshabilitada, no rota', async () => {
    await query(`DELETE FROM informes_herramienta`);
    const c = await informes.configuracionPublica('biodiversidad', CUENTA);
    expect(c).toMatchObject({ habilitado: false, puedeDescargar: false });
  });

  it('una herramienta inexistente u oculta devuelve null', async () => {
    expect(await informes.configuracionPublica('no-existe', CUENTA)).toBeNull();
    await query(`UPDATE herramientas SET activa = false WHERE clave = 'biodiversidad'`);
    expect(await informes.configuracionPublica('biodiversidad', CUENTA)).toBeNull();
  });

  it('entrega la plantilla; sin logo oficial solo hay nombre y colores', async () => {
    const { plantilla } = await informes.configuracionPublica('biodiversidad', CUENTA);
    expect(plantilla).toEqual({
      institucion: 'Vigía · IIAP', subtitulo: null, pie: null, aviso: null,
      colorPrimario: '#009846', colorAcento: '#0F172A', logoUrl: null,
    });
  });
});

describe('administración', () => {
  it('actualiza la plantilla general y deja el resto igual', async () => {
    const g = await informes.actualizarGeneral({ institucion: 'IIAP', pie: 'Documento generado por el Vigía' });
    expect(g).toMatchObject({ institucion: 'IIAP', pie: 'Documento generado por el Vigía', acceso: 'usuarios' });
  });

  it('rechaza un cambio sin campos válidos', async () => {
    await expect(informes.actualizarGeneral({ logo_url: 'https://ejemplo.org/x.png' })).rejects.toMatchObject({ status: 400 });
  });

  it('fijar el logo devuelve el anterior para poder borrarlo', async () => {
    expect(await informes.fijarLogo('https://cdn.example.org/informes/a.webp')).toBeNull();
    expect(await informes.fijarLogo('https://cdn.example.org/informes/b.webp')).toBe('https://cdn.example.org/informes/a.webp');
    expect(await informes.fijarLogo(null)).toBe('https://cdn.example.org/informes/b.webp');
    expect((await informes.obtenerGeneral()).logo_url).toBeNull();
  });

  it('crea los ajustes de una herramienta que no los tenía', async () => {
    await query(`DELETE FROM informes_herramienta`);
    const r = await informes.actualizarHerramienta('biodiversidad', { activo: true, max_filas: 200 });
    expect(r).toMatchObject({ clave: 'biodiversidad', activo: true, max_filas: 200 });
  });

  it('una herramienta que no existe no se puede configurar', async () => {
    expect(await informes.actualizarHerramienta('no-existe', { activo: true })).toBeNull();
  });

  it('el listado incluye todas las herramientas, también las aún sin informe', async () => {
    const lista = await informes.listarHerramientas();
    const bio = lista.find((h) => h.clave === 'biodiversidad');
    expect(bio).toMatchObject({ activo: true, configurada: true });
    const otra = lista.find((h) => h.clave !== 'biodiversidad');
    if (otra) expect(otra).toMatchObject({ activo: false, configurada: false });
  });
});
