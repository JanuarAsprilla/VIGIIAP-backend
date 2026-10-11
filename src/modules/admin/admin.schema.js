import { z } from 'zod';

// REGRESIÓN (hallazgo de auditoría dinámica con ZAP, mismo patrón que
// documentos.schema.js#listDocumentosQuerySchema): ninguno de los endpoints
// de listado de este módulo validaba req.query con un schema -- cada uno
// tenía chequeos manuales parciales (o ninguno, como getErrorLog).
// getAuditLog en particular pasaba fechaDesde/fechaHasta crudos a
// `creado_en >= $N` contra una columna TIMESTAMPTZ sin validar el formato.

const paginationFields = {
  page:  z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
};

export const paginationQuerySchema = z.object(paginationFields);

// Mismo conjunto que admin.service.js#ROLES -- roles asignables vía filtro,
// nunca admin_sig/super_admin (esos tienen su propia vista/lista).
const ROLES = ['investigador', 'tecnico', 'institucional', 'publico'];

export const listUsuariosQuerySchema = z.object({
  ...paginationFields,
  rol:    z.enum(ROLES).optional(),
  activo: z.enum(['true', 'false']).optional(),
  q:      z.string().trim().max(200).optional(),
});

// YYYY-MM-DD -- mismo formato que calcularRango() en admin.service.js
// espera para 'desde'/'hasta' de período personalizado.
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD');

export const auditLogQuerySchema = z.object({
  ...paginationFields,
  modulo:     z.string().trim().min(1).max(100).optional(),
  accion:     z.string().trim().min(1).max(100).optional(),
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
  q:          z.string().trim().max(200).optional(),
});

export const listAdministradoresQuerySchema = z.object({
  ...paginationFields,
  activo: z.enum(['true', 'false']).optional(),
  q:      z.string().trim().max(200).optional(),
});

// `periodo` queda sin tipar aquí a propósito -- calcularRango() en
// admin.service.js ya valida su propio conjunto de valores y lanza 400
// "Período inválido" si no reconoce el valor; duplicar esa validación aquí
// solo cambiaría el status code (422 en vez de 400) sin ganar nada. Solo se
// valida el FORMATO de desde/hasta, que es lo que antes llegaba crudo a una
// columna TIMESTAMPTZ.
export const reportesQuerySchema = z.object({
  periodo: z.string().trim().optional(),
  desde:   fechaIso.optional(),
  hasta:   fechaIso.optional(),
});
