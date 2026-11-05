# Plan de respuesta a incidentes de seguridad

> **BORRADOR para revisión del IIAP.** Complementa [SECURITY.md](../../SECURITY.md) (reportes externos) y la [Política de tratamiento de datos](POLITICA_TRATAMIENTO_DATOS.md).

Un **incidente** es cualquier evento que comprometa o pueda comprometer la confidencialidad, integridad o disponibilidad de la plataforma o de los datos personales: acceso no autorizado, fuga o pérdida de datos, malware, cuenta administrativa comprometida, defacement, indisponibilidad por ataque, pérdida de copias de seguridad.

## 1. Roles

| Rol | Responsabilidad | Persona |
|---|---|---|
| Coordinador del incidente | Decide, coordina y deja el registro | `[A COMPLETAR]` |
| Responsable técnico | Contención, análisis y recuperación | `[A COMPLETAR]` |
| Responsable de datos personales | Evalúa el impacto sobre titulares y notifica | `[A COMPLETAR]` |
| Vocero institucional | Única voz hacia usuarios, prensa y autoridades | `[A COMPLETAR]` |
| Asesor jurídico | Obligaciones legales y contratos | `[A COMPLETAR]` |

Los contactos (teléfono de guardia incluido) deben estar impresos o guardados **fuera** de la plataforma.

## 2. Severidad

| Nivel | Criterio | Ejemplo | Primera respuesta |
|---|---|---|---|
| **Crítico** | Datos personales expuestos o cuenta de administrador comprometida | Acceso a la base de datos; admin con sesión robada | Inmediata |
| **Alto** | Compromiso probable o servicio caído por ataque | Intento masivo de acceso con éxito parcial; denegación de servicio | En 1 hora |
| **Medio** | Vulnerabilidad explotable sin evidencia de explotación | Reporte externo válido | En 1 día hábil |
| **Bajo** | Evento sin impacto | Escaneo bloqueado | Registro |

## 3. Fases

### 3.1 Detección y registro
Fuentes: alertas por correo a los administradores, registro de actividad (`audit_log`, alertas de seguridad), `error_log`, reportes por SECURITY.md, avisos de usuarios, monitoreo del servidor. Quien detecta avisa al coordinador y abre un registro con fecha y hora de detección (se necesita para los plazos legales).

### 3.2 Contención (primera hora)
Objetivo: frenar el daño sin destruir evidencia.
- Revocar sesiones: cerrar todas las sesiones de las cuentas afectadas (la plataforma permite revocar todos los refresh tokens por usuario) o de todos si hay duda.
- Desactivar las cuentas comprometidas; si es una cuenta administrativa, restablecer su contraseña y exigir 2FA.
- Rotar secretos si pudieron exponerse: `JWT_SECRET` (invalida todas las sesiones), claves de cifrado, credenciales de base de datos, almacenamiento, SMTP y OAuth. Rotar `JWT_SECRET` cierra todas las sesiones: es una medida drástica, pero eficaz.
- Activar el **modo mantenimiento** de la plataforma si hay riesgo de que el atacante siga extrayendo datos.
- Bloquear la IP o el origen en el servidor o en el borde.
- Conservar evidencia: copiar los logs, no reiniciar ni borrar nada antes de documentar.

### 3.3 Análisis
Determinar: qué ocurrió, desde cuándo, por qué vector, qué datos y cuántas personas se vieron afectadas, si hubo exfiltración. Fuentes: `audit_log` (con hash encadenado, para detectar manipulación), logs de acceso, historial de despliegues, registros del proveedor.

### 3.4 Erradicación y recuperación
Corregir la causa (parche, cambio de configuración), restaurar desde una copia limpia si es necesario, validar con pruebas y reabrir el servicio de forma gradual, con vigilancia reforzada durante al menos 72 horas.

### 3.5 Notificaciones
- **Superintendencia de Industria y Comercio (SIC).** Si el incidente afecta datos personales de bases de datos, el responsable debe reportar el incidente de seguridad al RNBD **dentro de los quince (15) días hábiles siguientes al momento en que lo detecta** (Circular Única de la SIC). El responsable de datos personales prepara el reporte con la descripción, fecha, bases y titulares afectados y medidas tomadas.
- **Titulares afectados.** Cuando haya riesgo para sus derechos, informarles sin demora indebida: qué pasó, qué datos, qué riesgo, qué hacer (cambiar contraseña, desconfiar de correos sospechosos) y cómo contactar al IIAP.
- **Otras autoridades** (por ejemplo ColCERT o CSIRT, y la autoridad ambiental si aplica) según el caso y el asesor jurídico.
- **Proveedores y encargados** (hosting, correo, almacenamiento) si están involucrados.

Todo comunicado público pasa por el vocero y el asesor jurídico.

### 3.6 Cierre y lecciones aprendidas
En los 10 días siguientes: informe con línea de tiempo, causa raíz, impacto, acciones tomadas y acciones preventivas con responsable y fecha. Actualizar este plan, el inventario y las pruebas automáticas (todo incidente deja una prueba que habría evitado la repetición).

## 4. Qué NO hacer

- No borrar logs ni reiniciar servicios antes de copiar la evidencia.
- No pagar rescates ni negociar con el atacante sin el asesor jurídico y la dirección.
- No comunicar por canales públicos antes de tener los hechos básicos.
- No reutilizar secretos expuestos.

## 5. Copias de seguridad y recuperación

| Elemento | Objetivo propuesto |
|---|---|
| Base de datos | Copia diaria **cifrada y fuera del servidor**; objetivo de pérdida máxima (RPO) 24 h |
| Archivos (almacenamiento de objetos) | Copia periódica fuera del servidor, con ciclo de vida definido |
| Tiempo de recuperación (RTO) | `[A DEFINIR POR EL IIAP]`; propuesta: 8 horas hábiles |
| Prueba de restauración | Mensual, a una base temporal, con registro del resultado |

Estado actual (revisión de noviembre de 2026): solo se respalda PostgreSQL, en el mismo servidor, sin cifrar y sin prueba de restauración; los archivos no se respaldan. Es un riesgo alto a corregir con prioridad.

## 6. Simulacros
Al menos uno al año: se simula, por ejemplo, el robo de una cuenta administrativa; se mide el tiempo hasta la contención y se corrigen los fallos del plan.
