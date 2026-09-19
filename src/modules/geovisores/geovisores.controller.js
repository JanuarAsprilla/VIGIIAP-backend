import { createGeovisorSchema, updateGeovisorSchema, toggleGeovisorSchema } from './geovisores.schema.js';
import * as geovisorService from './geovisores.service.js';
import { esGeometriaValida } from '../../utils/geometry.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try {
    res.json(await geovisorService.getAll(req.query, req.user));
  } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try {
    res.json(await geovisorService.getBySlug(req.params.slug, req.user));
  } catch (err) { next(err); }
}

export async function catalogo(req, res, next) {
  try {
    res.json({ temas: await geovisorService.obtenerCatalogoDeGeovisor(req.params.slug, req.user) });
  } catch (err) { next(err); }
}

/**
 * Proxy WMS GetMap -- `geometria` llega como JSON en el query string (mismo contrato que
 * producto6).
 *
 * A propósito se construye `params` desde la CADENA CRUDA de la query (`req.originalUrl`), nunca
 * desde `req.query` -- Express parsea `req.query` con `qs`, que interpreta corchetes/repeticiones
 * como objetos/arrays anidados; volver a serializar ESE objeto ya interpretado con
 * `new URLSearchParams(req.query)` usa un SEGUNDO parser (distinto al de `qs`) para la misma
 * entrada, y ambos pueden no coincidir en cómo interpretan una clave repetida o con corchetes --
 * un parser-differential clásico que podría dejar pasar algo que la lista blanca
 * (`PARAMS_WMS_PERMITIDOS`) no vio de la forma en que realmente se reenvía. Parseando la cadena
 * cruda una sola vez con `URLSearchParams` (que aplana todo a pares string/string, sin anidar
 * nada) se elimina la diferencia por completo -- un solo parser, una sola interpretación.
 */
export async function wms(req, res, next) {
  try {
    const queryCruda = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    let geometriaFiltro;
    const geometriaRaw = queryCruda.get('geometria');
    if (geometriaRaw) {
      const parseada = JSON.parse(geometriaRaw);
      if (!esGeometriaValida(parseada)) {
        return res.status(400).json({ error: 'Geometría de filtro inválida' });
      }
      geometriaFiltro = parseada;
    }
    queryCruda.delete('geometria');
    const respuesta = await geovisorService.proxyWmsDeGeovisor(req.params.slug, queryCruda, geometriaFiltro, req.user);
    res.status(respuesta.status);
    res.set('Content-Type', respuesta.headers.get('content-type') ?? 'image/png');
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) { next(err); }
}

export async function leyenda(req, res, next) {
  try {
    const respuesta = await geovisorService.proxyLeyendaDeGeovisor(req.params.slug, req.params.capaId, req.user);
    res.status(respuesta.status);
    res.set('Content-Type', respuesta.headers.get('content-type') ?? 'image/png');
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) { next(err); }
}

/**
 * Atributos de las features de una capa bajo el punto donde el usuario hizo clic -- el cliente
 * arma un pequeño polígono alrededor del clic (no un punto exacto: un clic casi nunca cae
 * justo sobre la geometría) y este endpoint devuelve qué hay ahí, para el popup de la capa.
 */
export async function consulta(req, res, next) {
  try {
    const geometriaRaw = req.query.geometria;
    if (!geometriaRaw || typeof geometriaRaw !== 'string') {
      return res.status(400).json({ error: 'Falta la geometría de la consulta' });
    }
    let geometria;
    try {
      geometria = JSON.parse(geometriaRaw);
    } catch {
      return res.status(400).json({ error: 'Geometría de consulta inválida' });
    }
    if (!esGeometriaValida(geometria)) {
      return res.status(400).json({ error: 'Geometría de consulta inválida' });
    }
    const resultado = await geovisorService.consultarCapaDeGeovisor(req.params.slug, req.params.capaId, geometria, req.user);
    res.json(resultado);
  } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createGeovisorSchema.parse(req.body);
    const geovisor = await geovisorService.create(data, req.user.id);
    registrarAuditoria({
      accion: 'create_geovisor',
      modulo: 'geovisores',
      entidadId: geovisor.id,
      descripcion: `Geovisor creado: ${geovisor.titulo}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.status(201).json(geovisor);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateGeovisorSchema.parse(req.body);
    const geovisor = await geovisorService.update(req.params.id, data);
    registrarAuditoria({
      accion: 'update_geovisor',
      modulo: 'geovisores',
      entidadId: geovisor.id,
      descripcion: `Geovisor actualizado: ${geovisor.titulo}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.json(geovisor);
  } catch (err) { next(err); }
}

export async function patchActivo(req, res, next) {
  try {
    const { activo } = toggleGeovisorSchema.parse(req.body);
    res.json(await geovisorService.toggleActivo(req.params.id, activo));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await geovisorService.remove(req.params.id);
    registrarAuditoria({
      accion: 'delete_geovisor',
      modulo: 'geovisores',
      entidadId: req.params.id,
      descripcion: 'Geovisor eliminado',
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}
