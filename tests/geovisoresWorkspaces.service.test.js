import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWfs: vi.fn(),
  obtenerCapacidadesWcs: vi.fn(),
}));

import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { obtenerCapacidadesWfs, obtenerCapacidadesWcs } from '../src/modules/geovisores/geoserver.connector.js';
import { listarWorkspacesDeConexion } from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

beforeEach(() => {
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(obtenerCapacidadesWfs).mockReset();
  vi.mocked(obtenerCapacidadesWcs).mockReset();
});

describe('listarWorkspacesDeConexion — descubrimiento de workspaces antes de crear un geovisor', () => {
  it('agrupa capas WFS+WCS por workspace y cuenta cuántas capas tiene cada uno', async () => {
    vi.mocked(obtenerCapacidadesWfs).mockResolvedValue([
      { id: 't_15_geologia:unidades' },
      { id: 't_15_geologia:fallas' },
    ]);
    vi.mocked(obtenerCapacidadesWcs).mockResolvedValue([
      { id: 't_20_hidrologia:cuencas' },
    ]);

    const workspaces = await listarWorkspacesDeConexion('conexion-uuid-1');

    expect(workspaces).toEqual([
      { id: 't_15_geologia', nombre: 'Geologia', totalCapas: 2 },
      { id: 't_20_hidrologia', nombre: 'Hidrologia', totalCapas: 1 },
    ]);
  });

  it('excluye el workspace de comunidades étnicas/resguardos aunque esté publicado en GeoServer', async () => {
    vi.mocked(obtenerCapacidadesWfs).mockResolvedValue([
      { id: 't_32_areas_reglamentacion_especial:resguardos' },
      { id: 't_15_geologia:unidades' },
    ]);
    vi.mocked(obtenerCapacidadesWcs).mockResolvedValue([]);

    const workspaces = await listarWorkspacesDeConexion('conexion-uuid-1');

    expect(workspaces.map((w) => w.id)).toEqual(['t_15_geologia']);
  });

  it('devuelve lista vacía si la conexión no publica ninguna capa', async () => {
    vi.mocked(obtenerCapacidadesWfs).mockResolvedValue([]);
    vi.mocked(obtenerCapacidadesWcs).mockResolvedValue([]);

    expect(await listarWorkspacesDeConexion('conexion-uuid-1')).toEqual([]);
  });

  it('propaga el error si la conexión no existe o está desactivada (obtenerConexionParaConector ya valida esto)', async () => {
    vi.mocked(obtenerConexionParaConector).mockRejectedValue(
      Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 }),
    );

    await expect(listarWorkspacesDeConexion('no-existe')).rejects.toMatchObject({ status: 404 });
  });
});
