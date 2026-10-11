import { describe, it, expect } from 'vitest';
import {
  severidadDeAccion, condicionSeveridad, EXCLUIR_SUPER_ADMIN, SEVERIDADES, ACCIONES_CRITICAS,
} from '../src/modules/admin/auditoriaCatalogo.js';
import { interpretarUserAgent } from '../src/utils/userAgent.js';
import { enmascararEmail } from '../src/utils/auditLog.js';

describe('severidadDeAccion()', () => {
  it('clasifica como crítica lo que compromete cuentas, permisos o configuración', () => {
    for (const accion of ['refresh_token_reuse', 'login_blocked', 'update_rol', 'delete_usuario', 'update_configuracion']) {
      expect(severidadDeAccion(accion)).toBe('critica');
    }
  });

  it('clasifica como advertencia los fallos de acceso y los cambios sensibles', () => {
    for (const accion of ['login_failed', 'change_password', 'sesion_revocada', 'update_usuario']) {
      expect(severidadDeAccion(accion)).toBe('advertencia');
    }
  });

  it('toda eliminación o exportación es advertencia aunque la acción sea nueva', () => {
    expect(severidadDeAccion('delete_algo_nuevo')).toBe('advertencia');
    expect(severidadDeAccion('export_algo_nuevo')).toBe('advertencia');
  });

  it('lo demás es informativo', () => {
    expect(severidadDeAccion('login')).toBe('info');
    expect(severidadDeAccion('create_mapa')).toBe('info');
    expect(severidadDeAccion(undefined)).toBe('info');
  });

  it('las acciones críticas del resumen coinciden con las que se clasifican como críticas', () => {
    expect(ACCIONES_CRITICAS.every((a) => severidadDeAccion(a) === 'critica')).toBe(true);
  });
});

describe('condicionSeveridad()', () => {
  it('numera los placeholders a continuación de los parámetros existentes', () => {
    const params = ['x', 'y'];
    const sql = condicionSeveridad('critica', params);

    expect(params).toHaveLength(3);
    expect(sql).toContain('$3::text[]');
  });

  // Regresión (la encontró la prueba de integración con Postgres real): un $N agregado a
  // `params` pero ausente del SQL hace que Postgres falle con "could not determine data type".
  it.each(SEVERIDADES)('todo parámetro que agrega para "%s" aparece en el SQL', (severidad) => {
    const params = [];
    const sql = condicionSeveridad(severidad, params);

    params.forEach((_, i) => expect(sql).toContain(`$${i + 1}::text[]`));
  });

  it('advertencia excluye las críticas e incluye prefijos delete_/export_', () => {
    const sql = condicionSeveridad('advertencia', []);

    expect(sql).toMatch(/NOT accion = ANY/);
    expect(sql).toContain("accion LIKE 'delete\\_%'");
    expect(sql).toContain("accion LIKE 'export\\_%'");
  });

  it('info excluye críticas y advertencias', () => {
    const sql = condicionSeveridad('info', []);

    expect(sql.match(/NOT/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('solo existen las tres gravedades esperadas', () => {
    expect(SEVERIDADES).toEqual(['critica', 'advertencia', 'info']);
  });
});

describe('EXCLUIR_SUPER_ADMIN', () => {
  it('conserva los eventos sin usuario (NULL) además de excluir super_admin', () => {
    expect(EXCLUIR_SUPER_ADMIN).toMatch(/usuario_id IS NULL OR usuario_id NOT IN/);
  });
});

describe('interpretarUserAgent()', () => {
  it('reconoce Chrome en macOS de escritorio', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(interpretarUserAgent(ua)).toEqual({ dispositivo: 'escritorio', navegador: 'Chrome', sistema: 'macOS' });
  });

  it('reconoce Safari en iPhone como móvil', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(interpretarUserAgent(ua)).toEqual({ dispositivo: 'movil', navegador: 'Safari', sistema: 'iOS' });
  });

  it('distingue Edge de Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
    expect(interpretarUserAgent(ua)).toMatchObject({ navegador: 'Edge', sistema: 'Windows' });
  });

  it('reconoce una tableta Android (sin "Mobile")', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
    expect(interpretarUserAgent(ua)).toMatchObject({ dispositivo: 'tablet', sistema: 'Android' });
  });

  it('reconoce herramientas y bots', () => {
    expect(interpretarUserAgent('curl/8.4.0').navegador).toBe('curl');
    expect(interpretarUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)').navegador).toBe('Bot');
  });

  it('sin User-Agent devuelve todo en null', () => {
    expect(interpretarUserAgent(null)).toEqual({ dispositivo: null, navegador: null, sistema: null });
    expect(interpretarUserAgent('')).toEqual({ dispositivo: null, navegador: null, sistema: null });
  });
});

describe('enmascararEmail()', () => {
  it('deja dos letras del usuario y el dominio', () => {
    expect(enmascararEmail('Ana.Perez@iiap.org.co')).toBe('an***@iiap.org.co');
  });

  it('no revela correos de una sola letra', () => {
    expect(enmascararEmail('a@iiap.org.co')).toBe('a***@iiap.org.co');
  });

  it('entradas que no son un correo se ocultan por completo', () => {
    expect(enmascararEmail('sin-arroba')).toBe('***');
    expect(enmascararEmail('')).toBe('***');
    expect(enmascararEmail(null)).toBe('***');
  });
});
