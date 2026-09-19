-- Permite renombrar una categoría sin romper la FK de geovisores.
-- mapas.categoria y documentos.tipo no tienen FK (son TEXT libres desde el
-- diseño original) — el rename se completa a mano en la misma transacción,
-- ver categorias.service.js#rename.
ALTER TABLE geovisores DROP CONSTRAINT geovisores_categoria_fkey;
ALTER TABLE geovisores ADD CONSTRAINT geovisores_categoria_fkey
  FOREIGN KEY (categoria) REFERENCES categorias(nombre) ON UPDATE CASCADE;
