# Política de cookies y almacenamiento local

> **BORRADOR para revisión jurídica.** Versión `[X.Y]` — vigente desde `[FECHA]`.

VIGIA-IIAP no utiliza cookies publicitarias, no se integra con redes sociales y no envía sus datos de uso a servicios de analítica de terceros (como Google Analytics). Solo usa las cookies y el almacenamiento local **estrictamente necesarios** para que la plataforma funcione, y unas pocas preferencias que usted controla.

## 1. Qué son

Las cookies son pequeños archivos que el sitio guarda en su navegador. El «almacenamiento local» (`localStorage` y `sessionStorage`) cumple una función parecida. En esta política hablamos de ambos.

## 2. Cookies estrictamente necesarias

Se crean solo al iniciar sesión o durante un trámite de seguridad. Son indispensables para mantener su sesión y proteger su cuenta; sin ellas la plataforma no puede funcionar, por eso no requieren su aceptación (sí le informamos de ellas). Todas son `HttpOnly` (no accesibles desde scripts), `Secure` (solo por HTTPS) y `SameSite=Lax`, y pertenecen únicamente al dominio de la plataforma.

| Cookie | Duración | Finalidad |
|---|---|---|
| `vigiiap_token` | 15 minutos (8 horas en acceso de visitante) | Mantiene su sesión iniciada |
| `vigiiap_refresh` | 30 días | Renueva la sesión sin pedirle la contraseña de nuevo |
| `vigiiap_2fa_temp` | 15 minutos | Paso intermedio del inicio de sesión con segundo factor |
| `vigiiap_expired_temp` | 15 minutos | Paso intermedio para cambiar una contraseña vencida |
| `vigiiap_oauth_csrf`, `vigiiap_oauth_cv` | Minutos (solo durante el flujo) | Protegen el inicio de sesión con Google o Microsoft contra falsificación |

## 3. Almacenamiento local

| Clave | Almacén | Finalidad | Duración |
|---|---|---|---|
| `vigiiap_theme_v1` | Local | Recordar el tema claro u oscuro | Hasta que lo borre |
| `vigiiap_notif_enabled_v1` | Local | Recordar si activó las notificaciones | Hasta que lo borre |
| `vigiiap:welcome-seen` | Local | No repetir el mensaje de bienvenida | Hasta que lo borre |
| `vigiiap:*-cols` | Local | Recordar cuántas columnas muestra cada listado | Hasta que lo borre |
| `choco_*` | Local | Guardar en su equipo los datos agregados del Panel Chocó para no descargarlos de nuevo (son estadísticas del DANE, no datos suyos) | Hasta que lo borre o cambie la versión |
| `vigiiap_analytics_session` | De sesión | Identificador aleatorio **anónimo** de la visita, para contar visitas sin saber quién es usted | Hasta cerrar la pestaña o 30 minutos de inactividad |
| `vigiiap:preload-error-reload`, `vigiiap:chunk-reload-attempted` | De sesión | Evitar un bucle de recarga si una actualización falla | Hasta cerrar la pestaña |

## 4. Analítica de uso

Para saber cómo se usa la plataforma y mejorarla, registramos las páginas visitadas (ruta, tipo de dispositivo, navegador y sitio de referencia), la dirección IP y la ubicación aproximada que se deduce de ella (país, departamento y ciudad) mediante una base local. **No se envía a terceros, no se vincula con su cuenta aunque haya iniciado sesión y no se usa para identificarle.** La IP se elimina automáticamente a los 90 días y el resto de la información de la visita a los 2 años.

`[Si el IIAP aprueba el identificador persistente de visitantes recurrentes, describirlo aquí: finalidad, que solo se activa si usted lo acepta, duración máxima de 13 meses y cómo retirarlo.]`

## 5. Servicios de terceros que reciben su dirección IP

Para mostrar los mapas, su navegador descarga imágenes directamente de proveedores externos, que reciben su dirección IP y la zona consultada. Estos proveedores aplican sus propias políticas:

- OpenStreetMap y OpenTopoMap (mapas base).
- Esri / ArcGIS Online (imágenes satelitales).
- GBIF (miniaturas de fotografías de biodiversidad).
- Google y Microsoft, únicamente si usted decide iniciar sesión con su cuenta de ellos.

No controlamos las cookies que esos proveedores puedan establecer en sus propios dominios.

## 6. Cómo controlarlas

- Desde su navegador puede ver, bloquear o borrar cookies y almacenamiento local en cualquier momento (Configuración → Privacidad). Si bloquea las cookies necesarias no podrá iniciar sesión.
- El tema y las preferencias se restablecen al borrar los datos del sitio.
- `[Enlace «Preferencias de privacidad» al pie de la página, cuando se implemente el aviso con opciones.]`

## 7. Cambios y contacto

Si cambiamos las cookies que usamos, actualizaremos esta política y su número de versión. Para consultas: `[CORREO DE DATOS PERSONALES DEL IIAP]`. Más información sobre sus datos en la [Política de tratamiento de datos personales](POLITICA_TRATAMIENTO_DATOS.md).
