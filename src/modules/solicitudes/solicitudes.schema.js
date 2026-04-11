import { z } from 'zod';

const TIPOS = ['acceso', 'dato', 'colaboracion', 'otro'];
const ESTADOS = ['pendiente', 'en_revision', 'aprobada', 'rechazada'];

export const createSolicitudSchema = z.object({
  tipo:        z.enum(TIPOS, { errorMap: () => ({ message: `Tipo debe ser uno de: ${TIPOS.join(', ')}` }) }),
  descripcion: z.string().min(10, 'Descripción mínimo 10 caracteres'),
});

export const updateEstadoSchema = z.object({
  estado:     z.enum(ESTADOS, { errorMap: () => ({ message: `Estado debe ser uno de: ${ESTADOS.join(', ')}` }) }),
  nota:       z.string().optional(),
});
