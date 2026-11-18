/**
 * Quita de una URL los valores que funcionan como credencial antes de escribirla en los logs de acceso:
 * tokens de restablecimiento y verificación en la ruta, y los parámetros del callback de OAuth.
 */
export function redactarUrl(url) {
  return String(url ?? '')
    .replace(/(\/(?:reset-password|verificar-email)\/)[^/?#\s]+/g, '$1[REDACTED]')
    .replace(/([?&](?:code|state|id_token|access_token|token)=)[^&\s]+/gi, '$1[REDACTED]');
}
