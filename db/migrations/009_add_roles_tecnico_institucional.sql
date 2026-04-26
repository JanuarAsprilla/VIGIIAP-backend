-- Migración 009: Añadir roles 'tecnico' e 'institucional' al ENUM rol_usuario
-- Ejecutar en Supabase SQL Editor o con: npm run migrate

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'tecnico';
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'institucional';
