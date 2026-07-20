/json': { schema: { $ref: '#/components/schemas/Noticia' } } } }, 404: { description: 'No encontrada' } },
      },
    },
    // ─── Solicitudes ───────────────────────────────────────────────────────────
    '/solicitudes': {
      get: {
        tags: ['Solicitudes'],
        summary: 'Listar todas las solicitudes (admin_sig)',
        responses: { 200: { description: 'Lista de solicitudes', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Solicitud' } }, meta: { $ref: '#/components/schemas/PaginationMeta' } } } } } }, 403: { description: 'Sin permisos' } },
      },
      post: {
        tags: ['Solicitudes'],
        summary: 'Crear solicitud de acceso',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tipo', 'descripcion'],
                properties: {
                  tipo:        { type: 'string', enum: ['mapa', 'documento', 'datos', 'otro'] },
                  descripcion: { type: 'string', minLength: 10 },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Solicitud creada' }, 403: { description: 'Visitantes no pueden crear solicitudes' }, 422: { description: 'Datos inválidos' } },
      },
    },
    '/solicitudes/mis-solicitudes': {
      get: {
        tags: ['Solicitudes'],
        summary: 'Ver mis solicitudes',
        responses: { 200: { description: 'Solicitudes del usuario autenticado' } },
      },
    },
    '/solicitudes/{id}/estado': {
      patch: {
        tags: ['Solicitudes'],
        summary: 'Cambiar estado de una solicitud (admin_sig)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['pendiente', 'en_revision', 'aprobada', 'rechazada', 'resuelta'] }, nota: { type: 'string' } } } } } },
        responses: { 200: { description: 'Estado actualizado' }, 403: { description: 'Sin permisos' }, 404: { description: 'Solicitud no encontrada' } },
      },
    },
    // ─── Usuarios ──────────────────────────────────────────────────────────────
    '/usuarios/me': {
      get: {
        tags: ['Usuarios'],
        summary: 'Perfil del usuario autenticado',
        responses: { 200: { description: 'Datos del perfil' } },
      },
      patch: {
        tags: ['Usuarios'],
        summary: 'Actualizar perfil propio',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nombre: { type: 'string' }, institucion: { type: 'string' } } } } } },
        responses: { 200: { description: 'Perfil actualizado' } },
      },
    },
    '/usuarios/me/password': {
      patch: {
        tags: ['Usuarios'],
        summary: 'Cambiar contraseña propia',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['passwordActual', 'passwordNueva'], properties: { passwordActual: { type: 'string' }, passwordNueva: { type: 'string', description: 'Mín. 8 chars, mayúscula, minúscula, número, especial' } } } } } },
        responses: { 200: { description: 'Contraseña cambiada' }, 401: { description: 'Contraseña actual incorrecta' }, 422: { description: 'Nueva contraseña no cumple requisitos' } },
      },
    },
    // ─── Admin ─────────────────────────────────────────────────────────────────
    '/admin/usuarios': {
      get: {
        tags: ['Admin'],
        summary: 'Listar usuarios del sistema (admin_sig)',
        parameters: [
          { name: 'rol',    in: 'query', schema: { type: 'string' } },
          { name: 'activo', in: 'query', schema: { type: 'boolean' } },
          { name: 'q',      in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista paginada de usuarios' }, 403: { description: 'Sin permisos' } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Crear usuario desde el panel admin',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['nombre', 'email', 'rol'], properties: { nombre: { type: 'string' }, email: { type: 'string', format: 'email' }, rol: { type: 'string', enum: ['admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'] }, institucion: { type: 'string' } } } } } },
        responses: { 201: { description: 'Usuario creado. Se envía email con contraseña temporal.' }, 409: { description: 'Email ya registrado' } },
      },
    },
    // ── Sesiones ──────────────────────────────────────────────────────────────
    '/auth/sessions': {
      get: {
        tags: ['Autenticación'],
        summary: 'Listar sesiones activas',
        description: 'Devuelve los refresh tokens activos del usuario autenticado. Identifica la sesión actual.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: 'Lista de sesiones',
            content: { 'application/json': { schema: { type: 'array', items: {
              type: 'object',
              properties: {
                id:             { type: 'string', format: 'uuid' },
                ip:             { type: 'string' },
                userAgent:      { type: 'string' },
                creadoEn:       { type: 'string', format: 'date-time' },
                expiraEn:       { type: 'string', format: 'date-time' },
                esSesionActual: { type: 'boolean' },
              },
            } } } },
          },
          401: { description: 'No autenticado' },
        },
      },
      delete: {
        tags: ['Autenticación'],
        summary: 'Cerrar todas las sesiones',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'Todas las sesiones cerradas' },
          401: { description: 'No autenticado' },
        },
      },
    },
    '/auth/sessions/{id}': {
      delete: {
        tags: ['Autenticación'],
        summary: 'Cerrar una sesión específica',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Sesión cerrada' },
          404: { description: 'Sesión no encontrada' },
          401: { description: 'No autenticado' },
        },
      },
    },
    // ── Categorías ────────────────────────────────────────────────────────────
    '/categorias': {
      get: {
        tags: ['Categorías'],
        summary: 'Listar categorías activas',
        responses: { 200: { description: 'Lista de categorías' } },
      },
      post: {
        tags: ['Categorías'],
        summary: 'Crear categoría',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nombre: { type: 'string' } }, required: ['nombre'] } } } },
        responses: { 201: { description: 'Categoría creada' }, 400: { $ref: '#/components/responses/BadRequest' }, 401: { description: 'No autenticado' } },
      },
    },
    '/categorias/{nombre}': {
      delete: {
        tags: ['Categorías'],
        summary: 'Eliminar categoría (soft delete)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'nombre', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Eliminada' }, 404: { description: 'No encontrada' } },
      },
    },
    // ── Mapas — toggle activo ─────────────────────────────────────────────────
    '/mapas/{id}/activo': {
      patch: {
        tags: ['Mapas'],
        summary: 'Publicar o despublicar mapa',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { activo: { type: 'boolean' } }, required: ['activo'] } } } },
        responses: { 200: { description: 'Estado actualizado' }, 404: { description: 'Mapa no encontrado' } },
      },
    },
    // ── Admin — configuración ─────────────────────────────────────────────────
    '/admin/configuracion': {
      get: {
        tags: ['Admin'],
        summary: 'Obtener configuración del sistema',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Configuración actual' } },
      },
      put: {
        tags: ['Admin'],
        summary: 'Actualizar configuración del sistema',
        description: 'Claves permitidas: siteName, siteDesc, region, email, phone, address, modoMantenimiento, mensajeMantenimiento',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Guardado' }, 400: { $ref: '#/components/responses/BadRequest' } },
      },
    },
    // ── Admin — papelera ──────────────────────────────────────────────────────
    '/admin/papelera': {
      get: {
        tags: ['Admin'],
        summary: 'Ver elementos eliminados (papelera)',
        description: 'Solo super_admin. Filtra por tipo: mapa | documento | categoria',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'tipo', in: 'query', required: true, schema: { type: 'string', enum: ['mapa', 'documento', 'noticia', 'categoria'] } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Elementos en papelera paginados' }, 400: { $ref: '#/components/responses/BadRequest' } },
      },
    },
    '/admin/papelera/{tipo}/{id}/restaurar': {
      patch: {
        tags: ['Admin'],
        summary: 'Restaurar elemento eliminado',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'tipo', in: 'path', required: true, schema: { type: 'string', enum: ['mapa', 'documento', 'noticia', 'categoria'] } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Restaurado' }, 404: { description: 'No encontrado en papelera' } },
      },
    },
    // ── Admin — custodia, descargas, scan-log ─────────────────────────────────
    '/admin/custodia': {
      get: {
        tags: ['Admin'],
        summary: 'Cadena de custodia de un recurso',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'tipo', in: 'query', required: true, schema: { type: 'string', enum: ['mapa', 'documento'] } },
          { name: 'id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Historial de custodia' } },
      },
    },
    '/admin/descargas': {
      get: {
        tags: ['Admin'],
        summary: 'Log de descargas',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Log paginado de descargas' } },
      },
    },
    '/admin/scan-log': {
      get: {
        tags: ['Admin'],
        summary: 'Log de escaneo de archivos subidos',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Resultados de escaneo (clean/rejected/suspicious)' } },
      },
    },
    // ── Descargas ─────────────────────────────────────────────────────────────
    '/descargar/{id}': {
      get: {
        tags: ['Documentos'],
        summary: 'Descargar documento (URL firmada R2)',
        description: 'Genera una URL de descarga temporal (presigned) para el documento. Registra en descarga_log.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'URL de descarga', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } } } } },
          404: { description: 'Documento no encontrado' },
        },
      },
    },
    '/admin/audit': {
      get: {
        tags: ['Admin'],
        summary: 'Log de auditoría (admin_sig)',
        parameters: [
          { name: 'page',   in: 'query', schema: { type: 'integer' } },
          { name: 'limit',  in: 'query', schema: { type: 'integer' } },
          { name: 'accion', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Entradas de auditoría paginadas' } },
      },
    },
    // ─── Health ────────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Sistema'],
        summary: 'Health check',
        security: [],
        servers: [{ url: '/' }],
        responses: {
          200: {
            description: 'API operativa',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:    { type: 'string', example: 'ok' },
                    uptime:    { type: 'integer', description: 'Segundos activo' },
                    timestamp: { type: 'string', format: 'date-time' },
                    version:   { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
