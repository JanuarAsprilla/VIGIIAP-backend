/**
 * Especificación OpenAPI 3.0 — VIGIIAP Backend API
 * Servida en GET /api/docs (Swagger UI) y GET /api/docs.json (spec cruda).
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VIGIIAP Backend API',
    description: `Sistema de Información Geoespacial del IIAP — API REST.

**Autenticación:** JWT vía cookie HttpOnly \`vigiiap_token\` (preferido) o header \`Authorization: Bearer <token>\`.

**Roles:** \`super_admin\` › \`admin_sig\` › \`investigador\` › \`institucional\` › \`publico\` › \`visitante\``,
    version: '1.0.0',
    contact: { name: 'IIAP', email: 'sistemas@iiap.gob.pe' },
  },
  servers: [
    { url: '/api', description: 'API base path' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'vigiiap_token',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Mensaje de error' },
          code:  { type: 'string', example: 'ACCOUNT_LOCKED' },
        },
      },
      ValidationError: {
        type: 'object',
        properties: {
          error:  { type: 'string', example: 'Datos de entrada inválidos' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field:   { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total:      { type: 'integer' },
          page:       { type: 'integer' },
          limit:      { type: 'integer' },
          totalPages: { type: 'integer' },
          hasNext:    { type: 'boolean' },
          hasPrev:    { type: 'boolean' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          nombre:      { type: 'string' },
          email:       { type: 'string', format: 'email' },
          rol:         { type: 'string', enum: ['super_admin', 'admin_sig', 'investigador', 'institucional', 'publico', 'visitante'] },
          institucion: { type: 'string', nullable: true },
          activo:      { type: 'boolean' },
          creado_en:   { type: 'string', format: 'date-time' },
        },
      },
      Mapa: {
        type: 'object',
        properties: {
          id:              { type: 'string', format: 'uuid' },
          titulo:          { type: 'string' },
          slug:            { type: 'string' },
          categoria:       { type: 'string' },
          anio:            { type: 'integer' },
          descripcion:     { type: 'string', nullable: true },
          thumbnail_url:   { type: 'string', format: 'uri', nullable: true },
          archivo_pdf_url: { type: 'string', format: 'uri', nullable: true },
          archivo_img_url: { type: 'string', format: 'uri', nullable: true },
          geovisor_url:    { type: 'string', format: 'uri', nullable: true },
          visibilidad:     { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] },
          activo:          { type: 'boolean' },
          creado_en:       { type: 'string', format: 'date-time' },
        },
      },
      Documento: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          titulo:      { type: 'string' },
          slug:        { type: 'string' },
          tipo:        { type: 'string' },
          anio:        { type: 'integer', nullable: true },
          autores:     { type: 'string', nullable: true },
          resumen:     { type: 'string', nullable: true },
          archivo_url: { type: 'string', format: 'uri', nullable: true },
          visibilidad: { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] },
          activo:      { type: 'boolean' },
          creado_en:   { type: 'string', format: 'date-time' },
        },
      },
      Noticia: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          titulo:      { type: 'string' },
          slug:        { type: 'string' },
          categoria:   { type: 'string', nullable: true },
          resumen:     { type: 'string', nullable: true },
          imagen_url:  { type: 'string', format: 'uri', nullable: true },
          publicado:   { type: 'boolean' },
          visibilidad: { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] },
          creado_en:   { type: 'string', format: 'date-time' },
        },
      },
      Solicitud: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          tipo:        { type: 'string', enum: ['mapa', 'documento', 'datos', 'otro'] },
          descripcion: { type: 'string' },
          estado:      { type: 'string', enum: ['pendiente', 'aprobada', 'rechazada', 'resuelta'] },
          nota:        { type: 'string', nullable: true },
          respuesta:   { type: 'string', nullable: true },
          creado_en:   { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      BadRequest:    { description: 'Datos de entrada inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Unauthorized:  { description: 'Token inválido o ausente',  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Forbidden:     { description: 'Sin permisos para esta acción', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound:      { description: 'Recurso no encontrado',     content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    // ─── Auth ──────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login institucional / externo',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login exitoso',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user:  { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: { description: 'Credenciales incorrectas', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          422: { description: 'Datos inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          429: { description: 'Cuenta bloqueada por intentos fallidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/registro': {
      post: {
        tags: ['Auth'],
        summary: 'Registro de nuevo usuario (requiere verificación de email)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nombre', 'email', 'password'],
                properties: {
                  nombre:      { type: 'string', minLength: 2 },
                  email:       { type: 'string', format: 'email' },
                  password:    { type: 'string', description: 'Mín. 8 chars, mayúscula, minúscula, número, especial' },
                  institucion: { type: 'string' },
                  motivo:      { type: 'string' },
                  perfil:      { type: 'string', enum: ['investigador', 'tecnico', 'institucional', 'publico'] },
                  tipoAcceso:  { type: 'string', enum: ['institucional', 'externo'] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Usuario registrado. Se envía email de verificación.' },
          409: { description: 'Email ya registrado' },
          422: { description: 'Datos inválidos' },
        },
      },
    },
    '/auth/visitante': {
      post: {
        tags: ['Auth'],
        summary: 'Acceso rápido como visitante (token 8h, solo lectura pública)',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { nombre: { type: 'string', maxLength: 100 } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Token de visitante generado' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Perfil del usuario autenticado',
        responses: {
          200: { description: 'Perfil del usuario', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          401: { description: 'No autenticado' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Cerrar sesión (revoca token y borra cookie)',
        responses: {
          200: { description: 'Sesión cerrada' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Renovar access token con refresh token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Nuevos access token y refresh token' },
          401: { description: 'Refresh token inválido o expirado' },
        },
      },
    },
    // ─── Mapas ─────────────────────────────────────────────────────────────────
    '/mapas': {
      get: {
        tags: ['Mapas'],
        summary: 'Listar mapas (público)',
        security: [],
        parameters: [
          { name: 'page',      in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit',     in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'categoria', in: 'query', schema: { type: 'string' } },
          { name: 'q',         in: 'query', schema: { type: 'string' }, description: 'Búsqueda por título/descripción' },
          { name: 'admin',     in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Ver inactivos (requiere admin_sig)' },
        ],
        responses: {
          200: {
            description: 'Lista paginada de mapas',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Mapa' } },
                    meta: { $ref: '#/components/schemas/PaginationMeta' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Mapas'],
        summary: 'Crear mapa (admin_sig)',
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', required: ['titulo', 'categoria'], properties: { titulo: { type: 'string' }, categoria: { type: 'string' }, anio: { type: 'integer' }, descripcion: { type: 'string' }, visibilidad: { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] }, archivo_pdf: { type: 'string', format: 'binary' }, archivo_img: { type: 'string', format: 'binary' } } } } },
        },
        responses: {
          201: { description: 'Mapa creado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Mapa' } } } },
          401: { description: 'No autenticado' },
          403: { description: 'Sin permisos' },
          422: { description: 'Datos inválidos' },
        },
      },
    },
    '/mapas/{slug}': {
      get: {
        tags: ['Mapas'],
        summary: 'Obtener mapa por slug (público)',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Detalle del mapa', content: { 'application/json': { schema: { $ref: '#/components/schemas/Mapa' } } } },
          404: { description: 'Mapa no encontrado' },
        },
      },
    },
    // ─── Documentos ────────────────────────────────────────────────────────────
    '/documentos': {
      get: {
        tags: ['Documentos'],
        summary: 'Listar documentos (público)',
        security: [],
        parameters: [
          { name: 'page',  in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'tipo',  in: 'query', schema: { type: 'string' } },
          { name: 'anio',  in: 'query', schema: { type: 'integer' } },
          { name: 'q',     in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Lista paginada de documentos', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Documento' } }, meta: { $ref: '#/components/schemas/PaginationMeta' } } } } } },
        },
      },
      post: {
        tags: ['Documentos'],
        summary: 'Subir documento (admin_sig, investigador)',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['titulo'], properties: { titulo: { type: 'string' }, tipo: { type: 'string' }, anio: { type: 'integer' }, autores: { type: 'string' }, resumen: { type: 'string' }, visibilidad: { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] }, archivo: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: { description: 'Documento creado' }, 401: { description: 'No autenticado' }, 403: { description: 'Sin permisos' } },
      },
    },
    '/documentos/{slug}': {
      get: {
        tags: ['Documentos'],
        summary: 'Obtener documento por slug',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Detalle del documento', content: { 'application/json': { schema: { $ref: '#/components/schemas/Documento' } } } }, 404: { description: 'No encontrado' } },
      },
    },
    // ─── Noticias ──────────────────────────────────────────────────────────────
    '/noticias': {
      get: {
        tags: ['Noticias'],
        summary: 'Listar noticias publicadas (público)',
        security: [],
        parameters: [
          { name: 'page',      in: 'query', schema: { type: 'integer' } },
          { name: 'limit',     in: 'query', schema: { type: 'integer' } },
          { name: 'categoria', in: 'query', schema: { type: 'string' } },
          { name: 'q',         in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista paginada de noticias' } },
      },
      post: {
        tags: ['Noticias'],
        summary: 'Crear noticia (admin_sig)',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['titulo'], properties: { titulo: { type: 'string' }, resumen: { type: 'string' }, categoria: { type: 'string' }, publicado: { type: 'boolean' }, visibilidad: { type: 'string', enum: ['publico', 'usuarios', 'acreditados'] }, imagen: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: { description: 'Noticia creada' }, 403: { description: 'Sin permisos' } },
      },
    },
    '/noticias/{slug}': {
      get: {
        tags: ['Noticias'],
        summary: 'Obtener noticia por slug',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Detalle de la noticia', content: { 'application/json': { schema: { $ref: '#/components/schemas/Noticia' } } } }, 404: { description: 'No encontrada' } },
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
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['pendiente', 'aprobada', 'rechazada', 'resuelta'] }, nota: { type: 'string' } } } } } },
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
        description: 'Solo super_admin. Filtra por tipo: mapa | documento | noticia | categoria',
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
