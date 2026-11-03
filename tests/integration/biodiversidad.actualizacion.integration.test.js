/**
 * Servicio de actualización automática de biodiversidad contra PostgreSQL real: ajustes, credencial cifrada de GBIF
 * (nunca sale en claro), solicitudes (una pendiente por tarea) y la máquina de estados que usa el proceso aislado.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query } from '../../src/config/database.js';
import * as s from '../../src/modules/biodiversidad/actualizacion/actualizacion.service.js';

process.env.BIODIVERSIDAD_ENCRYPTION_KEY = 'ab'.repeat(32);

const PREFIJO = 'bio-act-test-';
const crearUsuario = async (nombre) => {
  const { rows: [u] } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES ($1, $2, 'x', 'admin_sig', true) RETURNING id`,
    [nombre, `${PREFIJO}${nombre.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@prueba.test`]);
  return u.id;
};
const cred = (extra = {}) => ({ gbif_usuario: 'persona_gbif', gbif_correo: 'persona@prueba.test', clave: 'clave-super-secreta', ...extra });

let ana;
let beto;
beforeEach(async () => {
  await query('TRUNCATE bio_actualizacion_ejecuciones, bio_actualizacion_credenciales RESTART IDENTITY');
  await query(`UPDATE bio_actualizacion_ajustes SET modo = 'publico', activa = true, frecuencia_dias = 30, credencial_usuario_id = NULL WHERE id = 1`);
  await query(`DELETE FROM usuarios WHERE email LIKE '${PREFIJO}%'`);
  ana = await crearUsuario('Ana');
  beto = await crearUsuario('Beto');
});
afterAll(async () => { await query(`DELETE FROM usuarios WHERE email LIKE '${PREFIJO}%'`); });

describe('estado() y ajustes', () => {
  it('por defecto: sin cuenta, activa, cada 30 días y sin credenciales', async () => {
    const e = await s.estado({ usuarioId: ana, esSuperAdmin: true });
    expect(e.ajustes).toMatchObject({ modo: 'publico', activa: true, frecuencia_dias: 30, credencial_usuario_id: null });
    expect(e.credenciales).toEqual([]);
    expect(e.cifrado_disponible).toBe(true);
  });

  it('el modo con cuenta exige designar a alguien que ya guardó su cuenta', async () => {
    await expect(s.actualizarAjustes(ana, { modo: 'cuenta' })).rejects.toMatchObject({ status: 422, codigo: 'sin_responsable' });
    await expect(s.actualizarAjustes(ana, { modo: 'cuenta', credencial_usuario_id: beto })).rejects.toMatchObject({ status: 422, codigo: 'sin_credencial' });
    await s.guardarCredencial(beto, cred());
    await s.actualizarAjustes(ana, { modo: 'cuenta', credencial_usuario_id: beto, frecuencia_dias: 15 });
    const e = await s.estado({ usuarioId: ana, esSuperAdmin: true });
    expect(e.ajustes).toMatchObject({ modo: 'cuenta', credencial_usuario_id: beto, frecuencia_dias: 15, credencial_nombre: 'Beto' });
  });
});

describe('credencial de GBIF', () => {
  it('se guarda cifrada y ninguna respuesta del servicio contiene la clave', async () => {
    await s.guardarCredencial(ana, cred());
    const { rows: [fila] } = await query('SELECT clave_cifrada FROM bio_actualizacion_credenciales WHERE usuario_id = $1', [ana]);
    expect(fila.clave_cifrada).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(fila.clave_cifrada).not.toContain('clave-super-secreta');
    const e = await s.estado({ usuarioId: ana, esSuperAdmin: true });
    expect(JSON.stringify(e)).not.toContain('clave-super-secreta');
    expect(JSON.stringify(e)).not.toContain('clave_cifrada');
    expect(e.credenciales[0]).toMatchObject({ nombre: 'Ana', gbif_usuario: 'persona_gbif', gbif_correo: 'persona@prueba.test' });
  });

  it('guardar otra vez la reemplaza; quien no es super administrador solo ve la suya', async () => {
    await s.guardarCredencial(ana, cred());
    await s.guardarCredencial(beto, cred({ gbif_usuario: 'otro_usuario' }));
    await s.guardarCredencial(ana, cred({ gbif_usuario: 'ana_nueva' }));
    const propia = await s.estado({ usuarioId: ana, esSuperAdmin: false });
    expect(propia.credenciales).toHaveLength(1);
    expect(propia.credenciales[0].gbif_usuario).toBe('ana_nueva');
    expect((await s.estado({ usuarioId: ana, esSuperAdmin: true })).credenciales).toHaveLength(2);
  });

  it('sin clave de cifrado configurada responde 503 y no guarda nada', async () => {
    const guardada = process.env.BIODIVERSIDAD_ENCRYPTION_KEY;
    delete process.env.BIODIVERSIDAD_ENCRYPTION_KEY;
    try {
      await expect(s.guardarCredencial(ana, cred())).rejects.toMatchObject({ status: 503, codigo: 'cifrado_no_configurado' });
      expect((await query('SELECT 1 FROM bio_actualizacion_credenciales')).rowCount).toBe(0);
    } finally {
      process.env.BIODIVERSIDAD_ENCRYPTION_KEY = guardada;
    }
  });

  it('no guarda la credencial de un usuario inexistente', async () => {
    await expect(s.guardarCredencial('00000000-0000-4000-8000-000000000000', cred())).rejects.toMatchObject({ status: 404 });
  });

  it('borrar la credencial que usa el modo con cuenta devuelve el sistema al modo sin cuenta', async () => {
    await s.guardarCredencial(ana, cred());
    await s.actualizarAjustes(ana, { modo: 'cuenta', credencial_usuario_id: ana });
    await s.borrarCredencial(ana);
    const e = await s.estado({ usuarioId: ana, esSuperAdmin: true });
    expect(e.ajustes).toMatchObject({ modo: 'publico', credencial_usuario_id: null });
    await expect(s.borrarCredencial(ana)).rejects.toMatchObject({ status: 404 });
  });
});

describe('solicitudes manuales', () => {
  it('una sola pendiente por tarea; tarea desconocida y «datos» sin cuenta se rechazan', async () => {
    const primera = await s.solicitar(ana, 'fotos');
    expect(primera).toMatchObject({ tarea: 'fotos', estado: 'solicitada' });
    await expect(s.solicitar(beto, 'fotos')).rejects.toMatchObject({ status: 409, codigo: 'ya_pendiente' });
    await expect(s.solicitar(ana, 'nada')).rejects.toMatchObject({ status: 422 });
    await expect(s.solicitar(ana, 'datos')).rejects.toMatchObject({ status: 409, codigo: 'requiere_cuenta' });
    await s.solicitar(ana, 'frescura');
  });

  it('listarEjecuciones trae quién la pidió', async () => {
    await s.solicitar(ana, 'fotos');
    const [e] = await s.listarEjecuciones(10);
    expect(e).toMatchObject({ tarea: 'fotos', disparador: 'manual', solicitado_por: 'Ana' });
  });
});

describe('proceso aislado: pendientes → iniciar → registrar', () => {
  it('crea las programadas de fotos y frescura (no «datos» sin cuenta) y no las repite', async () => {
    const primera = await s.pendientes();
    expect(primera.map((p) => p.tarea).sort()).toEqual(['fotos', 'frescura']);
    expect(primera.every((p) => p.disparador === 'programada')).toBe(true);
    expect((await s.pendientes())).toHaveLength(2);
  });

  it('con modo cuenta también programa «datos»; si la actualización está apagada no programa nada', async () => {
    await s.guardarCredencial(ana, cred());
    await s.actualizarAjustes(ana, { modo: 'cuenta', credencial_usuario_id: ana });
    expect((await s.pendientes()).map((p) => p.tarea).sort()).toEqual(['datos', 'fotos', 'frescura']);
    await query('TRUNCATE bio_actualizacion_ejecuciones');
    await s.actualizarAjustes(ana, { activa: false });
    expect(await s.pendientes()).toEqual([]);
  });

  it('una solicitud manual se atiende aunque la programación esté apagada', async () => {
    await s.actualizarAjustes(ana, { activa: false });
    await s.solicitar(ana, 'fotos');
    expect((await s.pendientes()).map((p) => p.tarea)).toEqual(['fotos']);
  });

  it('máquina de estados: iniciar solo una vez; registrar solo si está en curso; resumen acotado', async () => {
    const [p] = (await s.pendientes()).filter((x) => x.tarea === 'fotos');
    await expect(s.registrar(p.id, 'ok')).rejects.toMatchObject({ status: 409, codigo: 'no_en_curso' });
    await s.iniciar(p.id);
    await expect(s.iniciar(p.id)).rejects.toMatchObject({ status: 409 });
    await expect(s.registrar(p.id, 'quizas')).rejects.toMatchObject({ status: 422, codigo: 'estado_invalido' });
    await expect(s.registrar(p.id, 'ok', { x: 'a'.repeat(25_000) })).rejects.toMatchObject({ status: 422, codigo: 'resumen_grande' });
    expect(await s.registrar(p.id, 'ok', { cargadas: 10 })).toMatchObject({ estado: 'ok' });
    await expect(s.registrar(p.id, 'ok')).rejects.toMatchObject({ status: 409 });
  });

  it('una tarea que terminó bien no vuelve a tocar dentro de la frecuencia; una que falló, sí', async () => {
    const lista = await s.pendientes();
    const fotos = lista.find((x) => x.tarea === 'fotos');
    const frescura = lista.find((x) => x.tarea === 'frescura');
    await s.iniciar(fotos.id); await s.registrar(fotos.id, 'ok');
    await s.iniciar(frescura.id); await s.registrar(frescura.id, 'error', { mensaje: 'GBIF no respondió' });
    expect((await s.pendientes()).map((p) => p.tarea)).toEqual(['frescura']);
  });

  it('una ejecución «en curso» abandonada por más de 6 horas se cierra como error', async () => {
    const [p] = await s.pendientes();
    await s.iniciar(p.id);
    await query(`UPDATE bio_actualizacion_ejecuciones SET inicio = now() - interval '7 hours' WHERE id = $1`, [p.id]);
    await s.pendientes();
    const { rows: [e] } = await query('SELECT estado, resumen FROM bio_actualizacion_ejecuciones WHERE id = $1', [p.id]);
    expect(e.estado).toBe('error');
    expect(e.resumen.motivo).toMatch(/no respondió/);
  });

  it('la línea base de frescura es la primera medición ok y se conserva', async () => {
    expect(await s.lineaBaseFrescura()).toBeNull();
    const lista = await s.pendientes();
    const f = lista.find((x) => x.tarea === 'frescura');
    await s.iniciar(f.id);
    await s.registrar(f.id, 'ok', s.calcularFrescura({ aves: 100 }, null));
    expect(await s.lineaBaseFrescura()).toEqual({ aves: 100 });
  });
});
