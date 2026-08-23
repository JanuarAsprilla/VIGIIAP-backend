-- ─── Valor por defecto: Política de Privacidad (Ley 1581 de 2012 / Decreto 1377 de 2013) ──
-- La clave `politicaPrivacidad` es solo-datos (tabla EAV `configuracion`, ver
-- 005_configuracion.sql) — no requiere cambio de esquema. Este seed evita que
-- GET /api/v1/public/configuracion devuelva null en un despliegue nuevo antes
-- de que un super_admin guarde contenido propio desde el panel de Configuración.

INSERT INTO configuracion (clave, valor) VALUES
  ('politicaPrivacidad', $$En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013 de la República de Colombia, el IIAP informa lo siguiente sobre el tratamiento de sus datos personales:

Responsable del tratamiento: Instituto de Investigaciones Ambientales del Pacífico "John von Neumann" (IIAP), Calle 14 No. 1-61, Quibdó, Chocó, Colombia. Contacto: info@iiap.org.co, teléfono +57 (4) 671 1127.

Datos que se recolectan: Nombre, correo electrónico, institución y motivo de acceso al solicitar una cuenta; adicionalmente, dirección IP y registros de actividad de la sesión, con fines exclusivos de seguridad y auditoría del sistema. No se recolectan datos sensibles (salud, biometría, creencias) ni datos de menores de edad.

Finalidad del tratamiento: Sus datos se usan para gestionar el acceso a la plataforma y verificar su vínculo institucional, habilitar los módulos correspondientes a su rol, enviarle notificaciones sobre solicitudes, cambios de cuenta o de contraseña, y mantener registros de auditoría y seguridad del sistema. No se usan con fines comerciales ni se venden ni comparten con terceros ajenos a la operación del IIAP.

Sus derechos como titular: Usted tiene derecho a conocer qué datos suyos tiene el IIAP (acceso), solicitar la corrección de datos desactualizados o inexactos (rectificación), solicitar la eliminación de sus datos cuando no exista un deber legal o contractual de conservarlos (cancelación/supresión), y oponerse a un tratamiento específico de sus datos (oposición).

Cómo ejercer sus derechos: Escriba a info@iiap.org.co indicando claramente el derecho que desea ejercer y el correo con el que está registrado. Las consultas se resuelven en un máximo de 10 días hábiles y los reclamos en un máximo de 15 días hábiles, plazos que la ley permite prorrogar hasta 8 días hábiles adicionales si se le informa oportunamente el motivo de la demora. Desde su perfil dentro de la plataforma también puede consultar y corregir directamente sus datos de contacto.

Autorización y vigencia: Al marcar la casilla de aceptación en el formulario de solicitud de acceso, usted otorga autorización previa, expresa e informada para el tratamiento aquí descrito. Sus datos se conservan mientras su cuenta permanezca activa y el tiempo adicional que exijan obligaciones legales aplicables. El IIAP aplica medidas técnicas razonables para proteger su información (cifrado de contraseñas, control de acceso por roles, registros de auditoría), sin que ello constituya una garantía absoluta frente a cualquier incidente de seguridad.$$)
ON CONFLICT (clave) DO NOTHING;
