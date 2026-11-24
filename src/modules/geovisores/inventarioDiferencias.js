/**
 * Definición de cada tipo del inventario y el cálculo (puro) de qué es nuevo, cambiado, igual o eliminado entre lo que
 * GeoServer publica ahora y lo guardado. Las filas viajan en snake_case, igual que las columnas.
 */
export const TIPOS_INVENTARIO = {
  espacios: {
    tabla: 'geoserver_inventario_espacios',
    clave: 'nombre',
    columnas: [
      { nombre: 'namespace_uri', tipo: 'text' },
      { nombre: 'titulo_servicio', tipo: 'text' },
      { nombre: 'resumen_servicio', tipo: 'text' },
      { nombre: 'aislado', tipo: 'boolean' },
    ],
  },
  capas: {
    tabla: 'geoserver_inventario_capas',
    clave: 'capa_id',
    columnas: [
      { nombre: 'espacio', tipo: 'text' },
      { nombre: 'nombre', tipo: 'text' },
      { nombre: 'titulo', tipo: 'text' },
      { nombre: 'resumen', tipo: 'text' },
      { nombre: 'palabras_clave', tipo: 'text[]' },
      { nombre: 'tipo', tipo: 'text' },
      { nombre: 'estilo_defecto', tipo: 'text' },
      { nombre: 'estilos', tipo: 'text[]' },
      { nombre: 'bbox', tipo: 'jsonb' },
      { nombre: 'crs', tipo: 'text[]' },
      { nombre: 'almacen', tipo: 'text' },
      { nombre: 'habilitada', tipo: 'boolean' },
    ],
  },
  grupos: {
    tabla: 'geoserver_inventario_grupos',
    clave: 'grupo_id',
    columnas: [
      { nombre: 'espacio', tipo: 'text' },
      { nombre: 'nombre', tipo: 'text' },
      { nombre: 'titulo', tipo: 'text' },
      { nombre: 'resumen', tipo: 'text' },
      { nombre: 'modo', tipo: 'text' },
      { nombre: 'miembros', tipo: 'jsonb' },
      { nombre: 'bbox', tipo: 'jsonb' },
    ],
  },
  estilos: {
    tabla: 'geoserver_inventario_estilos',
    clave: 'estilo_id',
    columnas: [
      { nombre: 'nombre', tipo: 'text' },
      { nombre: 'espacio', tipo: 'text' },
      { nombre: 'formato', tipo: 'text' },
    ],
  },
};

// Orden de claves estable: jsonb de PostgreSQL no conserva el orden en que se escribió.
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, canonico(valor[k])]));
  }
  return valor ?? null;
}

const huella = (definicion, fila) => JSON.stringify(definicion.columnas.map((c) => canonico(fila[c.nombre])));

/**
 * @param definicion  entrada de TIPOS_INVENTARIO
 * @param guardadas   filas actuales de la tabla (con eliminado_en)
 * @param publicadas  filas que GeoServer publica ahora
 * @param puedeEliminar  false cuando la fuente no permite saber qué dejó de existir (p. ej. sin REST, espacios y estilos)
 * @returns {{ nuevos, cambiados, iguales, eliminados }} cada uno con las claves afectadas; nuevos/cambiados con la fila
 */
export function calcularDiferencias(definicion, guardadas, publicadas, puedeEliminar = true) {
  const { clave } = definicion;
  const porClave = new Map(guardadas.map((fila) => [fila[clave], fila]));
  const vistas = new Set();
  const resultado = { nuevos: [], cambiados: [], iguales: [], eliminados: [] };

  for (const fila of publicadas) {
    if (vistas.has(fila[clave])) continue;
    vistas.add(fila[clave]);
    const previa = porClave.get(fila[clave]);
    // Una fila que había desaparecido y vuelve cuenta como nueva.
    if (!previa || previa.eliminado_en) resultado.nuevos.push(fila);
    else if (huella(definicion, previa) !== huella(definicion, fila)) resultado.cambiados.push(fila);
    else resultado.iguales.push(fila[clave]);
  }
  if (puedeEliminar) {
    resultado.eliminados = guardadas.filter((fila) => !fila.eliminado_en && !vistas.has(fila[clave])).map((fila) => fila[clave]);
  }
  return resultado;
}

export const resumirDiferencias = (diferencias) => ({
  nuevos: diferencias.nuevos.length,
  cambiados: diferencias.cambiados.length,
  eliminados: diferencias.eliminados.length,
});
