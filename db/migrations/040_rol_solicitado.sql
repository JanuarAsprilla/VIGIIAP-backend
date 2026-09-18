-- 040: Solicitud de rol elevado desde "Completar Perfil" (login OAuth)
--
-- Una cuenta creada por Google/Microsoft nace en rol 'publico' (ver
-- src/modules/oauth/oauth.service.js). Si la persona indica en el formulario
-- de completar perfil que quiere ser investigador/técnico/institucional, esa
-- petición NO se concede sola — queda en rol_solicitado, pendiente de que un
-- admin la apruebe cambiando "rol" directamente desde el panel de Usuarios
-- (mismo mecanismo ya usado para el registro tradicional).

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_solicitado rol_usuario;

COMMENT ON COLUMN usuarios.rol_solicitado IS
  'Rol elevado solicitado por la persona (ej. tras completar perfil por OAuth) — pendiente de aprobación manual de un admin, que actúa cambiando "rol". NULL si no hay solicitud pendiente.';
