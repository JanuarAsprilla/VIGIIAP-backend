import { query } from '../../config/database.js';

export async function stats(req, res, next) {
  try {
    const [usuarios, solicitudes, documentos, noticias] = await Promise.all([
      query('SELECT COUNT(*) FROM usuarios WHERE activo = true'),
      query("SELECT COUNT(*) FROM solicitudes WHERE estado IN ('pendiente','en_revision')"),
      query('SELECT COUNT(*) FROM documentos WHERE activo = true'),
      query('SELECT COUNT(*) FROM noticias WHERE publicado = true'),
    ]);

    res.json({
      usuarios:             Number(usuarios.rows[0].count),
      solicitudesPendientes: Number(solicitudes.rows[0].count),
      documentos:           Number(documentos.rows[0].count),
      noticias:             Number(noticias.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
}
