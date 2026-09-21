import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}));

const { default: dns } = await import('node:dns/promises');
const { urlApuntaARedPrivada } = await import('../src/utils/ssrfGuard.js');

describe('urlApuntaARedPrivada', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('detecta una IP literal privada (RFC 1918) sin necesidad de resolver DNS', async () => {
    expect(await urlApuntaARedPrivada('http://192.168.1.10:8080/geoserver')).toBe(true);
    expect(await urlApuntaARedPrivada('http://10.0.5.1/geoserver')).toBe(true);
    expect(await urlApuntaARedPrivada('http://172.20.0.4/geoserver')).toBe(true);
  });

  it('detecta loopback, tanto IP literal como "localhost" resuelto', async () => {
    expect(await urlApuntaARedPrivada('http://127.0.0.1:9000/geoserver')).toBe(true);

    dns.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect(await urlApuntaARedPrivada('http://localhost/geoserver')).toBe(true);
  });

  it('detecta el rango de metadata de nube (169.254.169.254) vía link-local', async () => {
    expect(await urlApuntaARedPrivada('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  it('acepta una IP pública literal', async () => {
    expect(await urlApuntaARedPrivada('http://8.8.8.8/geoserver')).toBe(false);
  });

  it('resuelve el hostname y bloquea si CUALQUIER dirección resuelta es privada (DNS rebinding)', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await urlApuntaARedPrivada('https://geoserver-malicioso.example.com/wms')).toBe(true);
    expect(dns.lookup).toHaveBeenCalledWith('geoserver-malicioso.example.com', { all: true, verbatim: true });
  });

  it('acepta un hostname que resuelve a una IP pública (caso real: geo.siatpc.co)', async () => {
    dns.lookup.mockResolvedValue([{ address: '200.50.60.70', family: 4 }]);
    expect(await urlApuntaARedPrivada('https://geo.siatpc.co/geoserver/wms')).toBe(false);
  });

  it('no bloquea si la resolución DNS falla -- no es una guarda de disponibilidad', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await urlApuntaARedPrivada('https://dominio-inexistente-xyz.test/wms')).toBe(false);
  });

  it('detecta una IPv6 loopback y link-local literal', async () => {
    expect(await urlApuntaARedPrivada('http://[::1]/geoserver')).toBe(true);
    expect(await urlApuntaARedPrivada('http://[fe80::1]/geoserver')).toBe(true);
  });

  it('no revienta con una URL malformada -- deja que z.string().url() la rechace primero', async () => {
    expect(await urlApuntaARedPrivada('no-es-una-url')).toBe(false);
  });
});
