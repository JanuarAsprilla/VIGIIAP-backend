export function notFound(req, res) {
  // req.path es lo que Express provee (sin query string).
  // En tests o clientes directos puede venir como req.url/req.originalUrl — strip query string.
  const safePath = (req.path ?? req.url?.split('?')[0] ?? req.originalUrl?.split('?')[0] ?? '').slice(0, 100);
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${safePath}` });
}
