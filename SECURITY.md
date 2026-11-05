# Política de seguridad

## Versiones con soporte

Solo la última versión publicada en `main` recibe correcciones de seguridad.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub:
pestaña **Security → Report a vulnerability** de este repositorio.

Incluye, si puedes:

- Descripción del problema y componente afectado (endpoint, pantalla, módulo).
- Pasos para reproducirlo y el impacto que le ves.
- Versión o commit donde lo observaste.

## Qué esperar

- Acuse de recibo en un plazo de 5 días hábiles.
- Evaluación inicial de severidad en 10 días hábiles; te mantendremos informado del avance.
- Corrección: las vulnerabilidades críticas y altas se priorizan sobre cualquier otro trabajo.
- Divulgación coordinada: te pedimos no hacer público el hallazgo hasta que esté corregido o hasta
  pasados 90 días desde el reporte, lo que ocurra primero.
- Reconocimiento público al reportante una vez corregido, si lo deseas.

Si lo que encontraste expone datos personales, lo tratamos como incidente de seguridad según el
[plan de respuesta a incidentes](docs/cumplimiento/PLAN_RESPUESTA_INCIDENTES.md).

## Alcance

Este repositorio y la plataforma VIGIIAP desplegada. Quedan fuera las pruebas de
denegación de servicio, la ingeniería social y cualquier ataque contra
infraestructura de terceros (GeoServer ajenos, proveedores de correo o nube).

Prueba únicamente contra tu propio entorno local. No accedas, modifiques ni
descargues datos de otras personas.
