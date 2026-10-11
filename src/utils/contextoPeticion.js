import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Datos de la petición HTTP en curso (ID, IP, navegador y usuario) disponibles desde cualquier
 * capa sin tener que pasar `req` hacia abajo. Los usa registrarAuditoria() para completar lo que
 * el llamador no indicó: así los eventos creados desde un servicio también salen con IP.
 */
const almacen = new AsyncLocalStorage();

/** Ejecuta `fn` con `contexto` disponible para todo lo que se llame desde ahí (incluido lo asíncrono). */
export function ejecutarConContexto(contexto, fn) {
  return almacen.run(contexto, fn);
}

/** Contexto de la petición actual, o undefined fuera de una petición (scripts, pruebas, tareas). */
export function contextoActual() {
  return almacen.getStore();
}

/** Registra quién es el usuario autenticado de la petición en curso. No hace nada fuera de una petición. */
export function asignarUsuarioAlContexto(usuario) {
  const contexto = almacen.getStore();
  if (contexto && usuario) {
    contexto.usuarioId = usuario.id ?? null;
    contexto.usuarioEmail = usuario.email ?? null;
  }
}
