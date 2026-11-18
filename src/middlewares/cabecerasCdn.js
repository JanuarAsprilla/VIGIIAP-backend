const PRIVADO = 'private, no-store';
const MAX_AGE_NAVEGADOR_S_POR_DEFECTO = 30;

/** Apagado por defecto: sin CDN_CACHE_HEADERS=true la API no emite cabeceras de caché compartida. */
export const cabecerasCdnActivas = () => process.env.CDN_CACHE_HEADERS === 'true';

function maxAgeNavegador() {
  const crudo = process.env.CDN_BROWSER_MAX_AGE_S;
  if (crudo === undefined || crudo === '') return MAX_AGE_NAVEGADOR_S_POR_DEFECTO;
  const n = Math.trunc(Number(crudo));
  return n >= 0 ? n : MAX_AGE_NAVEGADOR_S_POR_DEFECTO;
}

/** Cualquier credencial (cookie de sesión o Authorization) o usuario ya resuelto vuelve la respuesta propia de esa persona. */
export function tieneCredenciales(req) {
  return Boolean(req.cookies?.vigiiap_token || req.headers?.authorization || req.user);
}

/** Respuesta con sesión o de administración: nunca en cachés compartidas ni en disco. */
export function marcarPrivada(res) {
  res.setHeader('Cache-Control', PRIVADO);
  res.vary?.('Cookie');
  res.vary?.('Authorization');
}

function puedeCompartirse(res) {
  const yaDecidida = res.getHeader?.('Cache-Control');
  return !yaDecidida && !res.getHeader?.('Set-Cookie') && (res.statusCode ?? 200) === 200;
}

/**
 * Decide la cabecera al responder (cuando ya se conoce el estado): `public` solo si es un 200 sin cookies que
 * fijar y sin Cache-Control propio; un error o cualquier duda queda `private, no-store`. Si el controlador ya
 * fijó su Cache-Control, se respeta.
 */
export function instalarCabecerasPublicas(res, ttlSeconds) {
  const jsonOriginal = res.json.bind(res);
  res.json = (data) => {
    const yaDecidida = res.getHeader?.('Cache-Control');
    if (puedeCompartirse(res)) {
      res.setHeader('Cache-Control', `public, max-age=${maxAgeNavegador()}, s-maxage=${ttlSeconds}`);
      res.vary?.('Cookie');
      res.vary?.('Authorization');
    } else if (!yaDecidida) {
      marcarPrivada(res);
    }
    return jsonOriginal(data);
  };
}
