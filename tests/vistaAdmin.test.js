import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/admin/modulos.service.js', () => ({ tienePermisoModulo: vi.fn() }));

import { tienePermisoModulo } from '../src/modules/admin/modulos.service.js';
import { esVistaAdmin } from '../src/utils/vistaAdmin.js';

describe('esVistaAdmin()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('un admin_sig con permiso ver en el módulo obtiene la vista de gestión', async () => {
    tienePermisoModulo.mockResolvedValue(true);
    expect(await esVistaAdmin('true', { id: 'a1', rol: 'admin_sig' }, 'documentos')).toBe(true);
    expect(tienePermisoModulo).toHaveBeenCalledWith({ id: 'a1', rol: 'admin_sig' }, 'documentos', 'ver');
  });

  it('un admin_sig SIN permiso ver en el módulo no obtiene la vista de gestión', async () => {
    tienePermisoModulo.mockResolvedValue(false);
    expect(await esVistaAdmin('true', { id: 'a1', rol: 'admin_sig' }, 'documentos')).toBe(false);
  });

  it('sin ?admin=true o sin rol de panel ni siquiera consulta permisos', async () => {
    expect(await esVistaAdmin(undefined, { rol: 'admin_sig' }, 'mapas')).toBe(false);
    expect(await esVistaAdmin('true', { rol: 'investigador' }, 'mapas')).toBe(false);
    expect(await esVistaAdmin('true', null, 'mapas')).toBe(false);
    expect(tienePermisoModulo).not.toHaveBeenCalled();
  });
});
