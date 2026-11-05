# Cumplimiento y protección de datos personales

Marco de cumplimiento de VIGIIAP frente a la **Ley 1581 de 2012** (protección de datos personales), el **Decreto 1074 de 2015** (que compila el Decreto 1377 de 2013 y el Decreto 886 de 2014) y la **Circular Única de la SIC**. Resume qué datos trata la plataforma, qué brechas se encontraron, qué se corrigió y qué decisiones solo puede tomar el IIAP.

> **Estado de estos documentos: BORRADOR TÉCNICO.** Los redactó el equipo de desarrollo a partir del código. No son asesoría jurídica. Antes de publicarlos deben ser revisados y aprobados por el asesor jurídico del IIAP y por el oficial o área responsable de datos personales. Los textos entre corchetes `[A COMPLETAR POR EL IIAP]` son datos que solo el instituto puede dar.

## Documentos

| Documento | Para qué sirve |
|---|---|
| [POLITICA_TRATAMIENTO_DATOS.md](POLITICA_TRATAMIENTO_DATOS.md) | Política de tratamiento de datos personales (art. 17 literal k de la Ley 1581). Es el texto que se publica y se versiona. |
| [POLITICA_COOKIES.md](POLITICA_COOKIES.md) | Qué cookies y almacenamiento usa la plataforma, para qué y cómo controlarlos. |
| [INVENTARIO_RNBD.md](INVENTARIO_RNBD.md) | Inventario de bases de datos con datos personales, base para el Registro Nacional de Bases de Datos (RNBD) y para el manual interno. |
| [PLAN_RESPUESTA_INCIDENTES.md](PLAN_RESPUESTA_INCIDENTES.md) | Qué hacer si ocurre una brecha de seguridad, incluida la notificación a la SIC. |
| [../../SECURITY.md](../../SECURITY.md) | Cómo reportar vulnerabilidades (divulgación responsable). |

## Resumen del análisis

**Lo que está bien.** No hay cookies analíticas ni publicitarias ni scripts de terceros de seguimiento. Todas las cookies que emite el servidor son estrictamente necesarias y llevan `HttpOnly`, `Secure` y `SameSite=Lax`. La analítica de uso es propia (no se envía a Google ni a otros), no se vincula a la cuenta del usuario y la IP se elimina a los 90 días. Las fuentes tipográficas están alojadas en la propia plataforma. Las contraseñas usan bcrypt y los secretos de 2FA van cifrados. Las coordenadas de especies amenazadas se ocultan en la API pública.

**Brechas encontradas y su estado.** (Prioridad según el riesgo de incumplimiento.)

| # | Brecha | Prioridad | Estado |
|---|---|---|---|
| 1 | No se guarda prueba de la autorización: la casilla del formulario no viaja al servidor (falta fecha, versión del texto aceptado e IP) | Alta | Pendiente de implementar (lote de privacidad) |
| 2 | El registro con Google/Microsoft y el acceso de visitante crean datos sin aviso ni autorización previa | Alta | Pendiente |
| 3 | No existen «eliminar mi cuenta» ni «descargar mis datos» para el titular | Alta | Pendiente |
| 4 | Borrar un usuario puede fallar (claves foráneas sin `ON DELETE`) o perder solicitudes en cascada | Alta | Pendiente |
| 5 | Tras eliminar a un usuario, su correo, IP y navegador permanecen en `audit_log`, `descarga_log`, `geo_custodia` y `file_scan_log` | Alta | Requiere decisión (ver abajo) |
| 6 | Varias tablas no tienen plazo de conservación (`descarga_log`, `geo_custodia`, `file_scan_log`, `visitantes`, `refresh_tokens`, `error_log`, `notificaciones`, `solicitudes`, logs de acceso) | Alta | Pendiente; plazos propuestos en el inventario |
| 7 | La política publicada omite al proveedor de correo, a Cloudflare R2, al hosting y a GBIF; no hay contratos de transmisión | Alta | Texto corregido en estos borradores; contratos por gestionar |
| 8 | Se exponen públicamente los nombres de observadores de GBIF (`registrado_por`, `identificado_por`) sin base declarada | Alta | Requiere decisión |
| 9 | Texto libre sin control (solicitudes, adjuntos, fichas) puede contener datos sensibles, étnicos o de menores | Media | Aviso en formularios + política |
| 10 | No hay protocolo de consentimiento libre, previo e informado (CLPI) para contenido comunitario en fichas, mapas y documentos | Media | Requiere decisión |
| 11 | La analítica con IP no avisa al visitante al entrar | Media | Aviso informativo (ver política de cookies) |
| 12 | La política no está versionada ni vuelve a pedir autorización al cambiar | Media | Pendiente |
| 13 | Los usuarios con rol `publico` no pueden editar su perfil y nadie puede corregir su correo | Media | Pendiente |
| 14 | Un solo consentimiento mezcla términos de uso y tratamiento de datos | Media | Pendiente |
| 15 | No hay registro de consultas y reclamos de los titulares ni responsable designado | Media | Requiere decisión |
| 16 | Las exportaciones de auditoría y descargas incluyen correo e IP | Media | Ya queda registrada la exportación; falta aviso |
| 17 | Confirmar la inscripción de las bases en el RNBD | Media | Requiere gestión del IIAP |
| 18 | La política citaba mal el plazo de prórroga de las consultas (son 5 días hábiles, no 8) | Baja | Corregido en estos borradores |

Los hallazgos de **seguridad técnica** de la revisión complementaria se corrigen en PRs separados del backend (el lote 1 corresponde a VIGIIAP-backend #295). Los de infraestructura (copias de seguridad fuera del servidor, correo del dominio, firewall) se listan abajo como decisiones del instituto.

## Decisiones que solo puede tomar el IIAP

1. **Responsable y canal.** Nombre del cargo o dependencia que atiende consultas y reclamos de datos personales, correo dedicado (por ejemplo `datospersonales@…`) y, si lo hay, oficial de protección de datos.
2. **Registro ante la SIC.** Confirmar con el asesor jurídico si el IIAP debe inscribir sus bases en el RNBD (las entidades públicas deben) y programar la inscripción o actualización.
3. **Proveedores y ubicación.** Qué proveedor de correo se usa realmente, dónde está alojado el servidor, en qué región está el almacenamiento de archivos y firmar los contratos de transmisión de datos con cada encargado.
4. **Datos tras eliminar una cuenta.** Los registros de seguridad (`audit_log`, descargas) necesitan una base y un plazo: o se seudonimiza el correo al eliminar al usuario, o se documenta que se conserva N años por seguridad e interés legítimo. La recomendación técnica es seudonimizar el correo y la IP al eliminar la cuenta y conservar el resto.
5. **Datos de terceros en el Observatorio.** Decidir si se siguen mostrando los nombres de observadores de GBIF (licencia abierta, pero son personas) o se muestran solo como «Observador GBIF».
6. **Comunidades étnicas.** Definir si se publica contenido de comunidades o sobre sus territorios y bajo qué protocolo de consentimiento (CLPI). Hasta definirlo, el equipo no debería cargar fichas con imágenes de personas ni coordenadas de sitios culturales sin ese soporte.
7. **Plazos de conservación.** Aprobar los plazos propuestos en el inventario.
8. **Copias de seguridad.** Elegir dónde se guardan fuera del servidor y quién custodia la clave de cifrado.
9. **Correo institucional.** Reforzar los registros SPF y DMARC del dominio `iiap.org.co` (hoy permiten suplantar el remitente de VIGIIAP). Lo gestiona quien administra el DNS.
10. **Menores de edad.** Decidir si la plataforma prohíbe expresamente el registro de menores y cómo se verifica.

## Mantenimiento

- Versionar la política: cada cambio sustancial lleva número de versión y fecha, y se guarda la versión que aceptó cada usuario.
- Revisar este inventario cada vez que se agregue un módulo que trate datos personales.
- Probar el plan de incidentes al menos una vez al año con un simulacro.
- Revisar anualmente proveedores, plazos de conservación y registros en el RNBD.
