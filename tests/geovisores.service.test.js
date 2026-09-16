import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { getBySlug } from '../src/modules/geovisores/geovisores.service.js';

const filaGeovisorPublico = {
  id: 'geovisor-uuid-1',
  slug: 'reportes-ambientales',
  titulo: 'Reportes Ambientales',
  subtitulo: null,
  descripcion: null,
  cita: null,
  categoria: 'biodiversidad',
  conexion_geoserver_id: 'conexion-uuid-1',
  workspaces_geoserver: [],
  color_por_tema: {},
  centro_lat: 5.55,
  centro_lng: -76.6,
  zoom_inicial: 8,
  basemap_defecto: 'calles',
  area_max_ha: null,
  presets_area: [],
  ia_habilitada: false,
  visibilidad: 'publico',
  thumbnail_url: null,
  activo: true,
  orden: 0,
  creado_en: new Date().toISOString(),
};

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe('getBySlug — filtrado de visibilidad', () => {
  it('un visitante sin sesión ve un geovisor público', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisorPublico] });
    const geovisor = await getBySlug('reportes-ambientales', null);
    expect(geovisor.slug).toBe('reportes-ambientales');
  });

  it('un visitante sin sesión NO ve un geovisor restringido a "usuarios"', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...filaGeovisorPublico, visibilidad: 'usuarios' }],
    });
    await expect(getBySlug('reportes-ambientales', null)).rejects.toMatchObject({ status: 404 });
  });

  it('un investigador autenticado sí ve un geovisor restringido a "usuarios"', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...filaGeovisorPublico, visibilidad: 'usuarios' }],
    });
    const geovisor = await getBySlug('reportes-ambientales', { rol: 'investigador' });
    expect(geovisor.visibilidad).toBe('usuarios');
  });

  it('un geovisor inactivo no aparece para el público (404), pero sí para admin_sig', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ ...filaGeovisorPublico, activo: false }] });
    await expect(getBySlug('reportes-ambientales', { rol: 'publico' })).rejects.toMatchObject({ status: 404 });

    vi.mocked(query).mockResolvedValueOnce({ rows: [{ ...filaGeovisorPublico, activo: false }] });
    const geovisor = await getBySlug('reportes-ambientales', { rol: 'admin_sig' });
    expect(geovisor.activo).toBe(false);
  });

  it('lanza 404 si el slug no existe', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await expect(getBySlug('no-existe', null)).rejects.toMatchObject({ status: 404 });
  });
});
