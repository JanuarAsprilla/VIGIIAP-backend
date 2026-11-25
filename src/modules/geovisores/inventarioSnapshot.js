import { esCapaIdValido } from './capaId.js';

/**
 * Une lo que cada fuente aporta en las filas del inventario (snake_case). WMS manda en capas y grupos (títulos reales);
 * WFS/WCS dicen si una capa es vectorial o raster; la REST aporta espacios, miembros/modo de grupos y estilos. Sin REST
 * los espacios se deducen del prefijo de las capas y conservan lo que ya se sabía de ellos.
 */

const separar = (id) => {
  const corte = id.indexOf(':');
  return corte < 0 ? { espacio: null, nombre: id } : { espacio: id.slice(0, corte), nombre: id.slice(corte + 1) };
};

const sinVacios = (valor) => valor || null;

function construirCapas({ wms, wfs, wcs, previas }) {
  const tipos = new Map();
  (wfs ?? []).forEach((c) => tipos.set(c.id, 'vectorial'));
  (wcs ?? []).forEach((c) => tipos.set(c.id, 'raster'));
  const externas = new Map([...(wfs ?? []), ...(wcs ?? [])].map((c) => [c.id, c]));
  const previaPorId = new Map(previas.map((f) => [f.capa_id, f]));
  const delWms = new Map(wms.capas.map((c) => [c.id, c]));

  return [...new Set([...delWms.keys(), ...externas.keys()])].filter(esCapaIdValido).map((id) => {
    const enWms = delWms.get(id);
    const externa = externas.get(id);
    const { espacio, nombre } = separar(id);
    const tituloExterno = externa && externa.nombre !== id ? externa.nombre : null;
    const estilos = (enWms?.estilos ?? []).map((e) => e.nombre);
    return {
      capa_id: id,
      espacio,
      nombre,
      titulo: sinVacios(enWms?.titulo) ?? tituloExterno,
      resumen: sinVacios(enWms?.resumen),
      palabras_clave: enWms?.palabrasClave ?? [],
      tipo: tipos.get(id) ?? previaPorId.get(id)?.tipo ?? 'vectorial',
      estilo_defecto: sinVacios(enWms?.estiloDefecto),
      estilos,
      bbox: enWms?.bbox ?? externa?.bbox ?? null,
      crs: enWms?.crs ?? [],
      almacen: null,
      habilitada: true,
    };
  });
}

function construirGrupos({ wms, rest }) {
  const delWms = new Map(wms.grupos.map((g) => [g.id, g]));
  const delRest = new Map((rest?.grupos ?? []).map((g) => [g.id, g]));
  return [...new Set([...delRest.keys(), ...delWms.keys()])].map((id) => {
    const r = delRest.get(id);
    const w = delWms.get(id);
    const { espacio, nombre } = separar(id);
    return {
      grupo_id: id,
      espacio: r ? r.espacio : espacio,
      nombre: r?.nombre ?? nombre,
      titulo: sinVacios(r?.titulo) ?? sinVacios(w?.titulo),
      resumen: sinVacios(r?.resumen) ?? sinVacios(w?.resumen),
      modo: r?.modo ?? null,
      miembros: r?.miembros?.length ? r.miembros : (w?.miembros ?? []),
      bbox: w?.bbox ?? null,
    };
  });
}

function construirEstilos({ capas, rest }) {
  const nombres = rest
    ? rest.estilos.map((e) => ({ nombre: e.nombre, espacio: e.espacio }))
    : capas.flatMap((c) => c.estilos).map((completo) => {
      const { espacio, nombre } = separar(completo);
      return { nombre, espacio };
    });
  const porId = new Map();
  for (const { nombre, espacio } of nombres) {
    const id = espacio ? `${espacio}:${nombre}` : nombre;
    porId.set(id, { estilo_id: id, nombre, espacio, formato: null });
  }
  return [...porId.values()];
}

function construirEspacios({ capas, grupos, rest, previos }) {
  const previoPorNombre = new Map(previos.map((f) => [f.nombre, f]));
  const delRest = new Map((rest?.espacios ?? []).map((e) => [e.nombre, e]));
  const nombres = new Set([
    ...delRest.keys(),
    ...capas.map((c) => c.espacio),
    ...grupos.map((g) => g.espacio).filter(Boolean),
  ]);
  return [...nombres].map((nombre) => {
    const r = delRest.get(nombre);
    const previo = previoPorNombre.get(nombre);
    return {
      nombre,
      namespace_uri: r ? r.namespaceUri : (previo?.namespace_uri ?? null),
      titulo_servicio: r ? r.tituloServicio : (previo?.titulo_servicio ?? null),
      resumen_servicio: r ? r.resumenServicio : (previo?.resumen_servicio ?? null),
      aislado: r ? r.aislado : (previo?.aislado ?? false),
    };
  });
}

/**
 * @param fuentes { wms:{capas,grupos}, wfs?, wcs?, rest?:{espacios,grupos,estilos}|null, previos:{espacios,capas} }
 * @returns {{ espacios, capas, grupos, estilos }}
 */
export function construirInventario({ wms, wfs, wcs, rest = null, previos }) {
  const capas = construirCapas({ wms, wfs, wcs, previas: previos.capas });
  const grupos = construirGrupos({ wms, rest });
  return {
    espacios: construirEspacios({ capas, grupos, rest, previos: previos.espacios }),
    capas,
    grupos,
    estilos: construirEstilos({ capas, rest }),
  };
}
