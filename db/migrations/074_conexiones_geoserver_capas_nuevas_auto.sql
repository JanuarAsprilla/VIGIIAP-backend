-- 074: capas nuevas automáticas por conexión de GeoServer.
-- Una capa publicada en GeoServer después de la línea base (capas_geoserver_vistas.es_linea_base) aparece sola en los
-- geovisores curados de sus workspaces, sin destapar las antiguas que se dejaron ocultas. Encendida para todas las
-- conexiones; super_admin puede apagarla por conexión. Reversión: db/rollback/074_conexiones_geoserver_capas_nuevas_auto.down.sql.
ALTER TABLE conexiones_geoserver ADD COLUMN IF NOT EXISTS capas_nuevas_auto BOOLEAN NOT NULL DEFAULT TRUE;
