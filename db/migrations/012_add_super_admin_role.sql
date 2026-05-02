-- Migración 012: Añadir rol 'super_admin' al ENUM rol_usuario
-- El super_admin puede crear y gestionar administradores y todos los roles.
-- Solo puede ser creado via script de administración del servidor.

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'super_admin';
