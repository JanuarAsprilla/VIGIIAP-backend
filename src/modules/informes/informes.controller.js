import { z } from 'zod';
import * as informesService from './informes.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { deleteFileByUrl } from '../../config/r2.js';
import logger from '../../utils/logger.js';

const formatoSchema = z.enum(informesService.FORMATOS);
const formatosSchema = z.array(formatoSchema).min(1, 'Elige al menos un formato').refine((f) => new Set(f).size === f.length, 'Formatos repetidos');
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Usa un color como #009846');
const textoOpcional = (max) => z.string().trim().max(max, `Máximo ${max} caracteres`).transform((v) => v || null).nullable();

const generalSchema = z.object({
  institucion: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120, 'Máximo 120 caracteres'),
  subtitulo: textoOpcional(200),
  pie: textoOpcional(500),
  aviso: textoOpcional(1000),
  color_primario: colorSchema,
  color_acento: colorSchema,
  acceso: z.enum(['publico', 'usuarios']),
  formatos: formatosSchema,
}).partial().refine((d) => Object.keys(d).length > 0, { message: 'No hay campos para actualizar' });

const herramientaSchema = z.object({
  activo: z.boolean(),
  formatos: formatosSchema.nullable(),
  max_filas: z.number().int().min(100, 'Mínimo 100 filas').max(50000, 'Máximo 50000 filas'),
}).partial().refine((d) => Object.keys(d).length > 0, { message: 'No hay campos para actualizar' });

const claveSchema = z.string().regex(/^[a-z0-9-]{2,50}$/);

function auditar(req, accion, entidadId, descripcion) {
  registrarAuditoria({
    accion, modulo: 'informes', entidadId, descripcion,
    usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
  });
}

/** El archivo anterior se borra después de guardar el nuevo: un fallo de almacenamiento no debe tumbar el cambio. */
function borrarArchivoViejo(url) {
  if (!url) return;
  deleteFileByUrl(url).catch((err) => logger.warn(`No se pudo borrar el logo anterior: ${err.message}`));
}

export async function configuracionPublica(req, res, next) {
  try {
    const clave = claveSchema.safeParse(req.params.herramienta);
    if (!clave.success) return res.status(404).json({ error: 'Herramienta no encontrada' });
    const config = await informesService.configuracionPublica(clave.data, req.user);
    if (!config) return res.status(404).json({ error: 'Herramienta no encontrada' });
    res.set('Cache-Control', 'no-store');
    res.json(config);
  } catch (err) { next(err); }
}

export async function panel(req, res, next) {
  try {
    const [general, herramientas] = await Promise.all([informesService.obtenerGeneral(), informesService.listarHerramientas()]);
    res.json({ general, herramientas });
  } catch (err) { next(err); }
}

export async function actualizarGeneral(req, res, next) {
  try {
    const parsed = generalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const general = await informesService.actualizarGeneral(parsed.data);
    auditar(req, 'update_informes_general', null, `Informes: configuración general actualizada (${Object.keys(parsed.data).join(', ')})`);
    res.json(general);
  } catch (err) { next(err); }
}

export async function subirLogo(req, res, next) {
  try {
    const url = req.body?.logo_url;
    if (!url) return res.status(400).json({ error: 'Selecciona una imagen para el logo' });
    const anterior = await informesService.fijarLogo(url);
    borrarArchivoViejo(anterior);
    auditar(req, 'update_informes_logo', null, 'Informes: logo actualizado');
    res.json({ logo_url: url });
  } catch (err) { next(err); }
}

export async function quitarLogo(req, res, next) {
  try {
    const anterior = await informesService.fijarLogo(null);
    borrarArchivoViejo(anterior);
    auditar(req, 'delete_informes_logo', null, 'Informes: logo eliminado');
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function actualizarHerramienta(req, res, next) {
  try {
    const clave = claveSchema.safeParse(req.params.clave);
    if (!clave.success) return res.status(404).json({ error: 'Herramienta no encontrada' });
    const parsed = herramientaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const resultado = await informesService.actualizarHerramienta(clave.data, parsed.data);
    if (!resultado) return res.status(404).json({ error: 'Herramienta no encontrada' });
    auditar(req, 'update_informes_herramienta', clave.data, `Informes: ${clave.data} (${Object.keys(parsed.data).join(', ')})`);
    res.json(resultado);
  } catch (err) { next(err); }
}
