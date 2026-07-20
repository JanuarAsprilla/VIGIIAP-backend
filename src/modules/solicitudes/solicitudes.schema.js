import { z } from 'zod';

const TIPOS = ['uso-suelo', 'linderos', 'estudio-ambiental', 'validacion', 'aprovechamiento', 'otro'];
const ESTADOS = ['pendiente', 'en_revision', 'aprobada', 'rechazada', 'resuelta'];

export const createSolicitudSchema = z.object({
  tipo:        z.enum(TIPOS, { errorMap: () => ({ message: `Tipo debe ser uno de: ${TIPOS.join(', ')}` }) }),
  descripcion: z.string().trim().min(10, 'Descripción mínimo 10 caracteres').max(1000),
});

export const updateEstadoSchema = z.object({
  estado:     z.enum(ESTADOS, { errorMap: () => ({ message: `Estado debe ser uno de: ${ESTADOS.join(', ')}` }) }),
  nota:       z.string().trim().min(5).max(2000).optional(),
});

export const responderSchema = z.object({
  respuesta: z.string().trim().min(10, 'La respuesta debe tener al menos 10 caracteres').max(2000),
});
