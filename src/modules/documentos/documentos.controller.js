import { createDocumentoSchema, updateDocumentoSchema } from './documentos.schema.js';
import * as docService from './documentos.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try { res.json(await docService.getAll(req.query)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try { res.json(await docService.getBySlug(req.params.slug)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createDocumentoSchema.parse(req.body);
    const doc  = await docService.create(data, req.user.id);
    registrarAuditoria({
      accion:       'create_documento',
      modulo:       'documentos',
      entidadId:    doc.id,
      descripcion:  `Documento subido: ${doc.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateDocumentoSchema.parse(req.body);
    const doc  = await docService.update(req.params.id, data);
    registrarAuditoria({
      accion:       'update_documento',
      modulo:       'documentos',
      entidadId:    req.params.id,
      descripcion:  `Documento actualizado: ${doc.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.json(doc);
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await docService.remove(req.params.id);
    registrarAuditoria({
      accion:       'delete_documento',
      modulo:       'documentos',
      entidadId:    req.params.id,
      descripcion:  `Documento eliminado`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
