-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Portal de Geovisores: configuración de presentación por geovisor
-- ─────────────────────────────────────────────────────────────────────────────
-- Pedido explícito del usuario: en el paso de "visibilidad" del formulario de
-- creación, el admin_sig decide no solo QUIÉN ve el geovisor (visibilidad ya
-- existente) sino CÓMO se muestra la información -- métricas, imágenes de las
-- capas (si las traen), y qué atributos mostrar en el popup/tarjeta de cada
-- capa con qué alias legible (hallazgo de la investigación del geoportal SGC:
-- los campos de atributo varían genuinamente por temática, ver
-- docs/PORTAL_GEOVISORES_DISENO.md § 6).

ALTER TABLE geovisores
  ADD COLUMN presentacion JSONB NOT NULL DEFAULT '{
    "mostrarMetricas": true,
    "mostrarImagenes": false,
    "campoImagenUrl": null,
    "camposPopup": []
  }'::jsonb;
