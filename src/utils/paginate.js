/**
 * Construye cláusulas SQL para paginación y retorna metadata estándar.
 * @param {object} query  - req.query con page y limit
 * @returns {{ limit, offset, meta: fn(total) }}
 */
export function paginate(query) {
  // Techo máximo de página — sin límite, offset=page*limit puede forzar full-scan DoS
  const MAX_PAGE = 10_000;
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(query.page) || 1));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;

  return {
    limit,
    offset,
    meta: (total) => ({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    }),
  };
}
