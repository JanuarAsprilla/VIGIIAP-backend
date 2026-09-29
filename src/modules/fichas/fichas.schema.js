import { z } from 'zod';

// El identificador NO se decide aquí -- se elige del catálogo de atributos
// reales de la capa (GET .../capas/:capaId/atributos), por eso solo se valida
// como string no vacío, nunca contra una lista fija.
export const configFichasSchema = z.object({
  conexionId: z.string().uuid(),
  capaId: z.string().min(1).max(300),
  campoIdentificador: z.string().min(1).max(100),
  campoEtiqueta: z.string().min(1).max(100).optional(),
});

export const fichaPuntoSchema = z.object({
  titulo: z.string().max(200).optional(),
  // Sin mínimo de 20 caracteres aquí a propósito -- guardar SIEMPRE debe
  // funcionar (ver FichaPuntoEditor.tsx en el frontend); el mínimo solo
  // bloquea la PUBLICACIÓN del geovisor (fase de completitud), nunca el
  // guardado de una ficha en progreso.
  descripcion: z.string().max(10000).default(''),
});
