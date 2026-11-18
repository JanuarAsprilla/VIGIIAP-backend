import { tieneCuenta } from '../../informes/informes.service.js';

/** Observador e identificador son personas: solo las cuentas institucionales los ven; el resto recibe null. */
export const puedeVerAutoria = (usuario) => tieneCuenta(usuario);

/** Copia del registro con la autoría anulada si `usuario` no puede verla (el original no se modifica). */
export function conAutoria(registro, usuario) {
  if (puedeVerAutoria(usuario)) return registro;
  return { ...registro, registrado_por: null, identificado_por: null };
}
