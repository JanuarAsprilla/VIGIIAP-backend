import { z } from 'zod';

/**
 * Esquema de edición parcial: todos los campos opcionales y SIN valores por defecto.
 * En zod 4, `.partial()` ya no neutraliza los `.default()` (en zod 3 un campo ausente quedaba
 * ausente): una edición que solo envía el título rellenaría visibilidad, zoom, capas, etc. con sus
 * valores por defecto y pisaría lo guardado.
 */
export function parcialSinDefaults(objeto) {
  const forma = Object.fromEntries(
    Object.entries(objeto.shape).map(([campo, esquema]) => [campo, esquema instanceof z.ZodDefault ? esquema.unwrap() : esquema]),
  );
  return z.object(forma).partial();
}
