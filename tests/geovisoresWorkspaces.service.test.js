/**
 * Tests unitarios para listarWorkspacesDeConexion — descubrimiento de workspaces
 * de una conexión GeoServer, para el selector del constructor de geovisores
 * (antes de que exista un geovisor guardado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWfs: vi.fn(),
  obtenerCapacidadesWcs: vi.fn(),
}));
vi.mock('../src/modules/geovisores/capasNuevas.service.js', () => ({
  obtenerCapasNuevas: vi.fn(),
}));

import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { obtenerCapasNuevas } from '../src/modules/geovisores/capasNuevas.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import { listarWorkspacesDeConexion } from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

beforeEach(() => {
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockReset().mockResolvedValue([]);
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockReset().mockResolvedValue([]);
  vi.mocked(obtenerCapasNuevas).mockReset().mockResolvedValue(new Set());
});

describe('listarWorkspacesDeConexion()', () => {
  it('agrupa capas vectoriales y raster por workspace crudo, con conteo y el detalle de cada capa', async () => {
    const cuencas = { id: 't_20_hidrologia:cuencas', nombre: 'Cuencas', tipo: 'vectorial' };
    const rios = { id: 't_20_hidrologia:rios', nombre: 'Ríos', tipo: 'vectorial' };
    const relieve = { id: 't_15_geologia:relieve', nombre: 'Relieve', tipo: 'raster' };
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([cuencas, rios]);
    geoserver.obtenerCapacidadesWcs.mockResolvedValue([relieve]);

    const result = await listarWorkspacesDeConexion('conexion-uuid-1');

    expect(obtenerConexionParaConector).toHaveBeenCalledWith('conexion-uuid-1');
    expect(result).toEqual(
      expect.arrayContaining([
        { id: 't_20_hidrologia', nombre: 'Hidrologia', totalCapas: 2, totalNuevas: 0, capas: [{ ...cuencas, nueva: false }, { ...rios, nueva: false }] },
        { id: 't_15_geologia', nombre: 'Geologia', totalCapas: 1, totalNuevas: 0, capas: [{ ...relieve, nueva: false }] },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('devuelve el id crudo del workspace (no el id de tema sin prefijo) — debe coincidir con workspacesGeoserver del geovisor', async () => {
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([
      { id: 't_20_hidrologia:cuencas', nombre: 'Cuencas', tipo: 'vectorial' },
    ]);

    const [workspace] = await listarWorkspacesDeConexion('conexion-uuid-1');
    expect(workspace.id).toBe('t_20_hidrologia');
    expect(workspace.id).not.toBe('hidrologia');
  });

  it('excluye siempre el workspace de comunidades étnicas / resguardos, aunque la conexión lo publique', async () => {
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([
      { id: 't_32_areas_reglamentacion_especial:resguardos', nombre: 'Resguardos', tipo: 'vectorial' },
      { id: 't_20_hidrologia:rios', nombre: 'Ríos', tipo: 'vectorial' },
    ]);

    const result = await listarWorkspacesDeConexion('conexion-uuid-1');
    expect(result.map((w) => w.id)).not.toContain('t_32_areas_reglamentacion_especial');
    expect(result.map((w) => w.id)).toContain('t_20_hidrologia');
  });

  it('retorna lista vacía si la conexión no publica ninguna capa', async () => {
    const result = await listarWorkspacesDeConexion('conexion-uuid-1');
    expect(result).toEqual([]);
  });

  it('ordena los workspaces alfabéticamente por nombre', async () => {
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([
      { id: 't_99_zoologia:fauna', nombre: 'Fauna', tipo: 'vectorial' },
      { id: 't_10_agricultura:cultivos', nombre: 'Cultivos', tipo: 'vectorial' },
    ]);

    const result = await listarWorkspacesDeConexion('conexion-uuid-1');
    expect(result.map((w) => w.nombre)).toEqual(['Agricultura', 'Zoologia']);
  });

  it('propaga el error si la conexión no existe o está desactivada', async () => {
    obtenerConexionParaConector.mockRejectedValueOnce(Object.assign(new Error('no encontrada'), { status: 404 }));
    await expect(listarWorkspacesDeConexion('no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('marca las capas nuevas y cuenta cuántas tiene cada workspace', async () => {
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([
      { id: 't_20_hidrologia:cuencas', nombre: 'Cuencas', tipo: 'vectorial' },
      { id: 't_20_hidrologia:rios', nombre: 'Ríos', tipo: 'vectorial' },
    ]);
    obtenerCapasNuevas.mockResolvedValueOnce(new Set(['t_20_hidrologia:rios']));

    const [workspace] = await listarWorkspacesDeConexion('conexion-uuid-1');

    expect(workspace.totalNuevas).toBe(1);
    expect(workspace.capas.map((c) => [c.id, c.nueva])).toEqual([
      ['t_20_hidrologia:cuencas', false],
      ['t_20_hidrologia:rios', true],
    ]);
  });

  it('registra todas las capas de la conexión en el seguimiento, incluidas las excluidas, pero no las devuelve', async () => {
    geoserver.obtenerCapacidadesWfs.mockResolvedValue([
      { id: 't_32_areas_reglamentacion_especial:resguardos', nombre: 'Resguardos', tipo: 'vectorial' },
      { id: 't_20_hidrologia:rios', nombre: 'Ríos', tipo: 'vectorial' },
    ]);

    const result = await listarWorkspacesDeConexion('conexion-uuid-1');

    expect(obtenerCapasNuevas).toHaveBeenCalledWith('conexion-uuid-1', [
      't_32_areas_reglamentacion_especial:resguardos',
      't_20_hidrologia:rios',
    ]);
    expect(result.flatMap((w) => w.capas.map((c) => c.id))).toEqual(['t_20_hidrologia:rios']);
  });
});
