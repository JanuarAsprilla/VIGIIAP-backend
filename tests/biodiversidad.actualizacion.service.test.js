import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ query: db.query }));

import * as s from '../src/modules/biodiversidad/actualizacion/actualizacion.service.js';

const AJUSTES = { modo: 'publico', activa: true, frecuencia_dias: 30, credencial_usuario_id: null, credencial_nombre: null };
const llamadas = () => db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
const responder = (...resultados) => resultados.reduce((m, r) => m.mockResolvedValueOnce(r), db.query);
const filas = (rows = []) => ({ rows, rowCount: rows.length });

const claveOriginal = process.env.BIODIVERSIDAD_ENCRYPTION_KEY;
beforeEach(() => { db.query.mockReset(); process.env.BIODIVERSIDAD_ENCRYPTION_KEY = 'ab'.repeat(32); });
afterEach(() => {
  if (claveOriginal === undefined) delete process.env.BIODIVERSIDAD_ENCRYPTION_KEY; else process.env.BIODIVERSIDAD_ENCRYPTION_KEY = claveOriginal;
});

describe('estado()', () => {
  it('el super administrador ve todas las credenciales; los demás solo la suya', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM bio_actualizacion_credenciales/.test(sql)) return filas([{ usuario_id: 'a' }]);
      if (/bio_actualizacion_ajustes a/.test(sql)) return filas([AJUSTES]);
      return filas([]);
    });
    const e = await s.estado({ usuarioId: 'a', esSuperAdmin: false });
    expect(e).toMatchObject({ ajustes: AJUSTES, cifrado_disponible: true, credenciales: [{ usuario_id: 'a' }], ultimas_ejecuciones: [], cortes: [] });
    const sqlCred = db.query.mock.calls.find(([q]) => /FROM bio_actualizacion_credenciales/.test(q));
    expect(sqlCred[0]).toContain('WHERE c.usuario_id = $1');
    expect(sqlCred[1]).toEqual(['a']);
    db.query.mockClear();
    await s.estado({ usuarioId: 'a', esSuperAdmin: true });
    const sqlSuper = db.query.mock.calls.find(([q]) => /FROM bio_actualizacion_credenciales/.test(q));
    expect(sqlSuper[0]).not.toContain('WHERE c.usuario_id');
    expect(JSON.stringify(e)).not.toContain('clave_cifrada');
  });
});

describe('listarEjecuciones()', () => {
  it('acota el límite entre 1 y 100', async () => {
    db.query.mockResolvedValue(filas([]));
    await s.listarEjecuciones(5000);
    await s.listarEjecuciones('x');
    await s.listarEjecuciones(0);
    expect(db.query.mock.calls.map(([, p]) => p[0])).toEqual([100, 30, 30]);
  });
});

describe('actualizarAjustes()', () => {
  it('aplica solo lo enviado y conserva lo demás', async () => {
    responder(filas(), filas([AJUSTES]), filas());
    const r = await s.actualizarAjustes('u1', { activa: false, frecuencia_dias: 15 });
    expect(r.despues).toMatchObject({ modo: 'publico', activa: false, frecuencia_dias: 15, credencial_usuario_id: null });
    const [sql, params] = db.query.mock.calls.at(-1);
    expect(sql).toContain('UPDATE bio_actualizacion_ajustes');
    expect(params).toEqual(['publico', false, 15, null, 'u1']);
  });

  it('el modo con cuenta exige responsable y que tenga credencial guardada', async () => {
    responder(filas(), filas([AJUSTES]));
    await expect(s.actualizarAjustes('u1', { modo: 'cuenta' })).rejects.toMatchObject({ status: 422, codigo: 'sin_responsable' });
    responder(filas(), filas([AJUSTES]), { rows: [], rowCount: 0 });
    await expect(s.actualizarAjustes('u1', { modo: 'cuenta', credencial_usuario_id: 'u2' })).rejects.toMatchObject({ status: 422, codigo: 'sin_credencial' });
    responder(filas(), filas([AJUSTES]), { rows: [{}], rowCount: 1 }, filas());
    await expect(s.actualizarAjustes('u1', { modo: 'cuenta', credencial_usuario_id: 'u2' })).resolves.toMatchObject({ despues: { modo: 'cuenta' } });
  });
});

describe('credenciales', () => {
  it('guardar cifra la clave antes de tocar la base y no la deja en claro en ninguna consulta', async () => {
    responder({ rows: [{}], rowCount: 1 }, filas());
    await s.guardarCredencial('u1', { gbif_usuario: 'persona', gbif_correo: 'p@x.co', clave: 'clave-ficticia' });
    const [sql, params] = db.query.mock.calls.at(-1);
    expect(sql).toContain('ON CONFLICT (usuario_id) DO UPDATE');
    expect(params[3]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain('clave-ficticia');
  });

  it('sin clave de cifrado no consulta nada y responde 503; usuario inexistente 404', async () => {
    delete process.env.BIODIVERSIDAD_ENCRYPTION_KEY;
    await expect(s.guardarCredencial('u1', { gbif_usuario: 'p', gbif_correo: 'a@b.co', clave: 'x' })).rejects.toMatchObject({ status: 503 });
    expect(db.query).not.toHaveBeenCalled();
    process.env.BIODIVERSIDAD_ENCRYPTION_KEY = 'ab'.repeat(32);
    responder({ rows: [], rowCount: 0 });
    await expect(s.guardarCredencial('nadie', { gbif_usuario: 'p', gbif_correo: 'a@b.co', clave: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('borrar: 404 si no había; si la había, repone el modo sin cuenta cuando era la automática', async () => {
    responder({ rows: [], rowCount: 0 });
    await expect(s.borrarCredencial('u1')).rejects.toMatchObject({ status: 404, codigo: 'sin_credencial' });
    responder({ rows: [{}], rowCount: 1 }, filas());
    await s.borrarCredencial('u1');
    expect(llamadas().at(-1)).toContain("SET modo = 'publico', credencial_usuario_id = NULL");
  });
});

describe('solicitar()', () => {
  it('rechaza tareas desconocidas; «datos» solo en modo cuenta; conflicto si ya hay una pendiente', async () => {
    await expect(s.solicitar('u1', 'otra')).rejects.toMatchObject({ status: 422 });
    responder(filas(), filas([AJUSTES]));
    await expect(s.solicitar('u1', 'datos')).rejects.toMatchObject({ status: 409, codigo: 'requiere_cuenta' });
    responder(filas());
    await expect(s.solicitar('u1', 'fotos')).rejects.toMatchObject({ status: 409, codigo: 'ya_pendiente' });
    responder(filas([{ id: 3, tarea: 'fotos', estado: 'solicitada' }]));
    await expect(s.solicitar('u1', 'fotos')).resolves.toMatchObject({ id: 3 });
  });
});

describe('proceso aislado', () => {
  it('pendientes: cierra abandonadas, programa lo que toca (sin «datos» sin cuenta) y devuelve las solicitadas', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/bio_actualizacion_ajustes a/.test(sql)) return filas([AJUSTES]);
      if (/estado = 'solicitada' ORDER/.test(sql)) return filas([{ id: 1, tarea: 'fotos', disparador: 'programada' }]);
      return filas();
    });
    expect(await s.pendientes()).toEqual([{ id: 1, tarea: 'fotos', disparador: 'programada' }]);
    const programadas = db.query.mock.calls.filter(([q]) => /SELECT \$1, 'programada'/.test(q)).map(([, p]) => p[0]);
    expect(programadas).toEqual(['fotos', 'frescura']);
  });

  it('pendientes con modo cuenta programa también «datos»; apagada no programa nada', async () => {
    db.query.mockImplementation(async (sql) => (/bio_actualizacion_ajustes a/.test(sql) ? filas([{ ...AJUSTES, modo: 'cuenta' }]) : filas()));
    await s.pendientes();
    expect(db.query.mock.calls.filter(([q]) => /SELECT \$1, 'programada'/.test(q)).map(([, p]) => p[0])).toEqual(['fotos', 'frescura', 'datos']);
    db.query.mockReset();
    db.query.mockImplementation(async (sql) => (/bio_actualizacion_ajustes a/.test(sql) ? filas([{ ...AJUSTES, activa: false }]) : filas()));
    await s.pendientes();
    expect(db.query.mock.calls.filter(([q]) => /SELECT \$1, 'programada'/.test(q))).toHaveLength(0);
  });

  it('iniciar y registrar respetan la máquina de estados y acotan el resumen', async () => {
    responder(filas());
    await expect(s.iniciar('1')).rejects.toMatchObject({ status: 409, codigo: 'no_pendiente' });
    responder(filas([{ id: 1, tarea: 'fotos' }]));
    await expect(s.iniciar('1')).resolves.toEqual({ id: 1, tarea: 'fotos' });
    await expect(s.registrar('1', 'quizas')).rejects.toMatchObject({ codigo: 'estado_invalido' });
    await expect(s.registrar('1', 'ok', { x: 'a'.repeat(25_000) })).rejects.toMatchObject({ codigo: 'resumen_grande' });
    responder(filas());
    await expect(s.registrar('1', 'ok', [1, 2])).rejects.toMatchObject({ codigo: 'no_en_curso' });
    expect(db.query.mock.calls.at(-1)[1][2]).toBe('{}');
    responder(filas([{ id: 1, tarea: 'fotos', estado: 'ok' }]));
    await expect(s.registrar('1', 'ok', { cargadas: 2 })).resolves.toMatchObject({ estado: 'ok' });
  });

  it('lineaBaseFrescura: null sin mediciones; con ellas, las bases por grupo', async () => {
    responder(filas());
    expect(await s.lineaBaseFrescura()).toBeNull();
    responder(filas([{ resumen: { grupos: { aves: { gbif: 1100, base: 1000, crecimiento_pct: 10 } } } }]));
    expect(await s.lineaBaseFrescura()).toEqual({ aves: 1000 });
  });
});
