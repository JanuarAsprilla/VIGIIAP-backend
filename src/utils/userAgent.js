/**
 * Interpretación ligera del User-Agent para mostrar "Chrome · macOS · escritorio" en la
 * auditoría. Sin dependencias: solo reconoce lo habitual y devuelve null en lo demás.
 */

const REGLAS_NAVEGADOR = [
  [/bot|crawl|spider|slurp/i, 'Bot'],
  [/curl\//i, 'curl'],
  [/postman|insomnia|python-requests|axios\//i, 'Cliente de API'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const REGLAS_SISTEMA = [
  [/Windows NT/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

function primeraCoincidencia(reglas, texto) {
  const regla = reglas.find(([patron]) => patron.test(texto));
  return regla ? regla[1] : null;
}

function dispositivoDe(ua) {
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'movil';
  return 'escritorio';
}

export function interpretarUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return { dispositivo: null, navegador: null, sistema: null };
  }
  const ua = userAgent.slice(0, 500);
  return {
    dispositivo: dispositivoDe(ua),
    navegador: primeraCoincidencia(REGLAS_NAVEGADOR, ua),
    sistema: primeraCoincidencia(REGLAS_SISTEMA, ua),
  };
}
