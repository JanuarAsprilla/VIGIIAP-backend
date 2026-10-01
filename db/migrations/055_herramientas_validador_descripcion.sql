-- Validador de Coordenadas: la herramienta ya no compara el municipio declarado en el Excel con el detectado
-- (se retiró de la interfaz), así que se quita esa frase de su descripción. Solo se actualiza si la descripción
-- sigue siendo la sembrada por 052_herramientas_validador.sql: no se pisa un texto editado por un administrador.
UPDATE herramientas
   SET descripcion = 'Valida cada punto de un Excel o CSV contra los límites de los 93 municipios del Chocó Biogeográfico: detecta coordenadas fuera del territorio, invertidas o repetidas, y exporta el resultado.',
       actualizado_en = NOW()
 WHERE clave = 'validador-coordenadas'
   AND descripcion LIKE '%municipios que no coinciden%';
