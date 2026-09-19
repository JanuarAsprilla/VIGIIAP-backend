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
  capas_seleccionadas: [],
  color_por_tema: {},
  centro_lat: 5.55,
  centro_lng: -76.6,
  zoom_inicial: 8,
  basemap_defecto: 'calles',
  area_max_ha: null,
  presets_area: [],
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

  it('filtra por visibilidad en la propia consulta SQL para un visitante sin sesión (no en JS después de leer)', async () => {
    // El filtrado real de "usuarios"/"acreditados" lo aplica Postgres vía el WHERE -- un mock
    // ingenuo no ejecuta ese WHERE, así que lo que se verifica aquí es que getBySlug le pide a la
    // consulta el filtro correcto (['publico']), no que "adivine" el resultado después de leer.
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisorPublico] });
    await getBySlug('reportes-ambientales', null);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params[1]).toEqual(['publico']);
  });

  it('un investigador autenticado consulta sin restricción de visibilidad (permitida = null → sin filtro extra)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisorPublico] });
    await getBySlug('reportes-ambientales', { rol: 'investigador' });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toContain('visibilidad = ANY');
    expect(params).toEqual(['reportes-ambientales']);
  });

  it('un investigador autenticado sí ve un geovisor restringido a "usuarios"', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...filaGeovisorPublico, visibilidad: 'usuarios' }],
    });
    const geovisor = await getBySlug('reportes-ambientales', { rol: 'investigador' });
    expect(geovisor.visibilidad).toBe('usuarios');
  });

  it('un geovisor inactivo no aparece por esta vía para NADIE, ni siquiera admin_sig -- getBySlug es siempre la vía pública (también usada por catálogo/WMS/leyenda); la curaduría admin de inactivos pasa por getAll(?admin=true) + PATCH por id, nunca por aquí', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] }); // el filtro "activo = true" ya vive en la SQL
    await expect(getBySlug('reportes-ambientales', { rol: 'publico' })).rejects.toMatchObject({ status: 404 });

    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await expect(getBySlug('reportes-ambientales', { rol: 'admin_sig' })).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 404 si el slug no existe', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await expect(getBySlug('no-existe', null)).rejects.toMatchObject({ status: 404 });
  });
});
