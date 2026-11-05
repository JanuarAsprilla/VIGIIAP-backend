# Inventario de bases de datos con datos personales

> **BORRADOR técnico** para el Registro Nacional de Bases de Datos (RNBD) y el manual interno de políticas y procedimientos. Elaborado a partir del esquema de la base de datos y del código (revisión de noviembre de 2026). Los plazos de conservación son **propuestas** que debe aprobar el IIAP. Estos datos describen el esquema; no contienen información de personas.

**Responsable:** IIAP. **Encargados:** ver [política](POLITICA_TRATAMIENTO_DATOS.md) §10. **Sistema:** PostgreSQL (alojado `[A COMPLETAR]`), almacenamiento de archivos Cloudflare R2, Redis (caché y límite de peticiones, sin datos personales persistentes).

## 1. Bases de datos

| # | Base (tabla) | Titulares | Datos personales | Categoría | Finalidad | Acceso (rol) | Conservación propuesta |
|---|---|---|---|---|---|---|---|
| 1 | `usuarios` | Usuarios registrados | Nombre, correo, institución, motivo de acceso, rol, foto, proveedor OAuth y su id, último ingreso, intentos fallidos; credenciales cifradas (contraseña con bcrypt, 2FA cifrado) | Identificación, contacto | Gestión de cuentas y acceso | La propia persona; admin con módulo `usuarios` | Cuenta activa; inactiva 24 meses → aviso y eliminación |
| 2 | `solicitudes`, `solicitud_archivos` | Solicitantes | Texto libre y archivos adjuntos | Identificación, posible contenido libre no controlado | Trámite de solicitudes | Admin con módulo `solicitudes` | `[5 años]` tras el cierre |
| 3 | `audit_log` | Usuarios y administradores | Correo, IP, navegador, acción, descripción (puede incluir nombres y correos), cambios | Identificación, técnico | Seguridad y trazabilidad | Admin con módulo `actividad` (los eventos de super_admin se ocultan) | 2 años. Solo anexable; cadena de hash |
| 4 | `descarga_log`, `geo_custodia` | Usuarios que descargan | Usuario, correo, IP, recurso | Identificación, técnico | Custodia de la información geográfica | Módulo `custodia` | 2 años (hoy sin plazo) |
| 5 | `file_scan_log` | Usuarios que suben archivos | IP de origen, usuario, hash del archivo | Técnico | Seguridad de las subidas | Módulo `custodia` | 1 año (hoy sin plazo) |
| 6 | `analytics_sessions`, `analytics_pageviews`, `analytics_eventos` | Visitantes (anónimos) | Id de sesión aleatorio, IP, país, departamento, ciudad, navegador, SO, dispositivo, referencia, UTM, rutas | Técnico, ubicación aproximada | Analítica de uso | Módulo de analítica | IP 90 días; resto 2 años (ya implementado) |
| 7 | `visitantes` | Visitantes con acceso rápido | Nombre opcional, IP, navegador | Identificación opcional, técnico | Acceso sin cuenta | Sin lectura expuesta | 90 días (hoy sin plazo) |
| 8 | `refresh_tokens` | Usuarios con sesión | Hash del token, IP, navegador, fechas | Técnico | Sesiones | La propia persona (lista de sesiones) | Expiración + 30 días (hoy no se purga) |
| 9 | `notificaciones`, `usuario_notificacion_prefs` | Usuarios | Mensajes (pueden nombrar a otras personas), preferencias | Contacto | Avisos internos | El destinatario | 12 meses |
| 10 | `correos_pendientes` | Destinatarios de correo | Destinatario, asunto, contenido HTML | Contacto | Cola de envío con reintentos | Sistema | Se borra el contenido al enviar; filas por antigüedad (ya implementado) |
| 11 | `error_log` | Posiblemente cualquiera | Mensaje y traza de errores, ruta; pueden contener fragmentos de datos | Técnico | Diagnóstico | Módulo `errores` | 180 días (hoy sin plazo) |
| 12 | `bio_actualizacion_credenciales` | Administrador designado | Usuario y correo de GBIF, clave cifrada | Credenciales | Actualizar datos de GBIF | Admin designado | Mientras se use; se elimina con el usuario |
| 13 | `biodiversidad.registro_detalle` | Observadores de GBIF (terceros) | Nombres de quien registró e identificó | Identificación | Crédito de la licencia de los datos | **Público** | Mientras dure el dato; requiere decisión del IIAP |
| 14 | Archivos en R2 | Usuarios, solicitantes, terceros | Fotos de perfil, adjuntos de solicitudes, imágenes y videos de fichas | Identificación, posible imagen de personas | Servicio de la plataforma | Según visibilidad | Con su registro de origen |
| 15 | Logs del servidor (morgan/winston) | Todos | IP, URL, navegador, referencia de cada petición | Técnico | Operación y seguridad | Quien administra el servidor | 90 días (rotación a configurar) |

## 2. Cookies y almacenamiento

Ver [POLITICA_COOKIES.md](POLITICA_COOKIES.md). Todas las cookies del servidor son estrictamente necesarias; no hay analítica ni publicidad de terceros.

## 3. Transmisiones y transferencias

| Destinatario | Datos | Requiere |
|---|---|---|
| Alojamiento | Todas las bases | Contrato de transmisión; ubicación `[A COMPLETAR]` |
| Proveedor de correo | Destinatario, asunto, cuerpo | Contrato de transmisión; país `[A COMPLETAR]` |
| Cloudflare R2 | Archivos | Contrato de transmisión; región `[A COMPLETAR]` |
| Google, Microsoft | IP en el inicio de sesión; reciben nombre, correo y foto al autorizar | Aviso previo (OAuth) |
| OSM, OpenTopoMap, Esri, GBIF | IP del navegador | Informado en la política |

## 4. Medidas de seguridad vigentes

Contraseñas con bcrypt; secretos de 2FA cifrados con AES; HTTPS con HSTS; CSP; control de acceso por roles y módulos; bloqueo de cuenta ante intentos fallidos (inicio de sesión y segundo factor); límites de peticiones; auditoría solo anexable con hash encadenado; ubicación exacta de especies amenazadas oculta en la API pública; modo mantenimiento.

**Pendiente (riesgo alto):** copias de seguridad cifradas y fuera del servidor, incluidos los archivos; roles de base de datos separados (migraciones y aplicación) y credenciales de almacenamiento con permisos mínimos; reforzar SPF y DMARC del dominio de correo.

## 5. Brechas con este inventario

Ver la tabla de brechas en el [README](README.md): autorización sin prueba, supresión y exportación para el titular, seudonimización al eliminar cuentas, plazos de conservación pendientes y datos de terceros en el Observatorio.
