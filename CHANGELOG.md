# Changelog

## [1.3.0](https://github.com/JanuarAsprilla/VIGIIAP-backend/compare/v1.2.1...v1.3.0) (2026-09-19)


### Features

* agrega terminosUso como campo público editable de configuración ([#125](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/125)) ([3c3167d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3c3167da6b043ecbeebbde5ca16e010fe1b82047))
* ajuste automático y gradual del límite de peticiones ([#123](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/123)) ([78b7e0f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/78b7e0f29009fbcebfe4e52ed5bfa473fe37fd82))
* soft delete para geovisores + purga permanente en Papelera ([#124](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/124)) ([5992947](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/599294749f5c808ecf381ec064d6ad0968192177))


### Bug Fixes

* eleva límites de rate limiting general y de autenticación ([#121](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/121)) ([109420c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/109420c382b9de60c936c1ee9becf246629a7d77))

## [1.2.1](https://github.com/JanuarAsprilla/VIGIIAP-backend/compare/v1.2.0...v1.2.1) (2026-09-19)


### Bug Fixes

* valida GEOSERVER_ENCRYPTION_KEY al arrancar y la documenta en .env.example ([#107](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/107)) ([b3a5c5d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b3a5c5dc8de8d5d5a67aa61c6d01b83ac8c37a1f))

## [1.2.0](https://github.com/JanuarAsprilla/VIGIIAP-backend/compare/v1.1.0...v1.2.0) (2026-09-19)


### Features

* capas individuales por geovisor (sin importar workspace/tema) ([786b169](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/786b1692f30bfb61e8ea2b219b3cce4b402921c2))
* endpoint de tendencias para el dashboard admin ([d48852f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d48852f05f427aade5f35387668afa9fe766bd4a))
* seleccionar capas individuales por geovisor, sin importar el workspace/tema ([64493a4](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/64493a4780c0ef26339571bf0dda4f6dd9000eae))


### Bug Fixes

* registro tradicional ahora requiere aval de admin para roles elevados ([99ee868](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/99ee868eeeb4a0c372eb14c67354781cd1f5ccd8))
* registro tradicional ya no asigna investigador/tecnico/institucional sin aval de admin ([a42ebb8](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a42ebb868b401b81f6b2a7b05adaa308d2142ada))

## [1.1.0](https://github.com/JanuarAsprilla/VIGIIAP-backend/compare/v1.0.0...v1.1.0) (2026-09-18)


### Features

* CORS extra, tope de rate limit y correo de respaldo dinámicos ([#97](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/97)) ([54f0da6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/54f0da6dbb00190623a8b7aee7765c88ac618d42))
* CRUD completo de categorías — agrega renombrar ([292dfcf](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/292dfcf0ba0a0b12a2988b639ec4da0c2bb4f5aa))
* CRUD completo de categorías — agrega renombrar ([480ade8](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/480ade861724e542f00fcf517836d48f2ce1a0ef))
* endpoint de consulta de features para el popup por capa + corrige acceso a capas no permitidas ([#108](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/108)) ([8e264dd](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8e264dd3486f9ce7cf3cd2637312808d9df52ac2))
* login con Google y Microsoft (OAuth2) + flujo de completar perfil ([#105](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/105)) ([8767d0f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8767d0f64689460939e54d9cf0db0875ea692a60))
* modulo nativo de geovisores (backend fase 1) - conector GeoServer, catalogo, CRUD, conexiones cifradas ([7936baa](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/7936baab3f547003e526714e8fbc26e4507fc1d3))
* **seguridad:** PKCE (RFC 7636) para el login OAuth ([#106](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/106)) ([0962c2b](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0962c2bd33fcaec27d59077a1d03fca18f22ce19))
* separar administradores de usuarios y permisos por módulo ([8460ffc](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8460ffcb4f6e1b82d07789866a57fdd8ee981860))
* separar administradores de usuarios y permisos por módulo ([f1caf6c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f1caf6c3640820718e1572a4957403ec5625eabc))
* SMTP dinámico desde el panel + alerta de cambios críticos ([#96](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/96)) ([e938c90](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e938c901996ce6af5133fae68e58b99094fb8044))
* solicitud de rol elevado desde "Completar Perfil" (login OAuth) ([#115](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/115)) ([226df78](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/226df78e787815d0cda4b3c5eb6e3c20795e7014))


### Bug Fixes

* agrega descubrimiento de workspaces y preview WMS por conexión ([b4ef03a](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b4ef03a2e0119513f324610869c789d7ffb4d3e4))
* agrega descubrimiento de workspaces y preview WMS por conexión ([f251428](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f25142883965396e22ec384d824ed03f679fdc7d))
* CORS bloqueaba TODA petición real de navegador en producción ([#93](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/93)) ([c58ef71](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c58ef71c27dffdda6486f4acde1fca13f0153c6d))
* elimina bypass de autorizacion en getBySlug y unifica el parseo de query en el proxy WMS ([b6b054d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b6b054d8b28ba1cbf7834434a796c38595343d16))
* incluir el detalle de capas por workspace en el descubrimiento ([312a1d5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/312a1d533ef6e740702b263b718fde2ce50d3668))
* no exponer al admin_sig las claves de configuración exclusivas de super_admin ([#101](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/101)) ([cdb29d7](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/cdb29d7704501d9aad79eb9eccee350ba52ce083))
* nombre real del visitante en vez de 'Visitante' fijo ([#95](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/95)) ([9484e45](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9484e4525ccfe24d47585ede13e69c7cacd16c36))

## 1.0.0 (2026-09-10)


### Features

* /admin/notificaciones endpoint + getAdminEmails con fallback ADMIN_EMAIL ([709b61f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/709b61fcec56f4f3bc7cc91583acb38712da4ae8))
* /health endpoint + graceful shutdown + account lockout ([6f6c8f2](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/6f6c8f2e59015651122bcabc048ab396a4e17273))
* /health endpoint + graceful shutdown + account lockout ([5323cb2](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5323cb22216fe69ee572a5530bf94f4881a9aa50))
* add TIPO_LABEL map and fix readable labels in email notifications ([9b8d91a](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9b8d91a6725e5ffc830fea10dcc28a0cc03d3a8f))
* **admin:** hace real el Modo Mantenimiento — antes el toggle no tenía ningún efecto ([#61](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/61)) ([3ead7e0](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3ead7e0963a695c0f2d0213736f4292759cb1751))
* **admin:** papelera — GET /api/admin/papelera + PATCH restaurar para super_admin ([0468741](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/04687416bd41adb787701c97296b4d4eac9e58e9))
* **api:** filtro q (búsqueda por nombre/email) en /admin/solicitudes ([3de2b60](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3de2b60c6e48b12dbf4f4b6acc43f7b1d18950c3))
* **api:** toggle activo/publicado en documentos y noticias ([e574cd1](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e574cd199dca116189ff703410f9846cbc4d5e62))
* arquitectura base Fase 2 — API REST VIGIIAP ([1e546d8](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1e546d85c1137e57a369aa2fd57cefaea44bc525))
* audit log en mapas, noticias y documentos ([569af7c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/569af7c9c9f93c9105340e890c7a72eeba40fb7c))
* **auth:** JWT en cookie HttpOnly — modo dual cookie + Bearer ([423ae4c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/423ae4c605ae39dccfa67aa630887398dabfad0b))
* **auth:** last_login_at en login + resetPassword revoca sesiones activas ([2429b4c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2429b4c46f925e095223e2942a1d4394b7a8db93))
* **auth:** verificación de email, recuperación de contraseña y CRUD admin completo ([2122eb4](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2122eb43cbe11ea454a7ab450e9dd609d5e02f49))
* auto-aplicar migraciones al iniciar + validar env vars R2/JWT en startup ([3b8c3b6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3b8c3b6ecd06abf51ca87636e5aa84f56daa225b))
* configuracion API, strongPassword validation, admin config endpoints ([16189c5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/16189c58ed9dda39c9152570a4c4255655a42d58))
* **data:** soft deletes en mapas, documentos, noticias, categorias — hard DELETE eliminado ([2ea6d91](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2ea6d91fbe8585a268582e70ab329999442ef52f))
* **db:** migración 020 — columna last_login_at en usuarios ([0e0c01d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0e0c01d6d9469a54fb8155ed72fac55079717484))
* **db:** migración 021 — soft deletes en mapas, documentos, noticias, categorias ([83eb015](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/83eb015ede32ff6ed31741284c4fa4faab99fb8b))
* **db:** soporte DATABASE_URL — simplifica configuración en Render/AWS ([6d5a35d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/6d5a35dd484221c5b1ff4a897c9da4a8e4eb6fa0))
* documentos — columna tamano_bytes, schema y service actualizados para Word/Excel ([a4da455](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a4da4554dbb08a6f6ed2a1c7e4ffe4f6ef86665f))
* elimina módulo noticias del backend ([d75509c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d75509cb6669038a5e67286d37426ba62e5b4ffd))
* **infra:** API v1 + keepalive GitHub Action ([d19ccb7](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d19ccb707d9c8ec9cc9cad2d4a1ff9f0b5198009))
* login dual visitante/institucional, emails y auditoría completa ([d317027](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d31702730855a1c2e2e26906da14cf69811b739e))
* make privacy policy editable, restricted to super_admin, and expose it publicly ([#55](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/55)) ([eea8e2c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/eea8e2c4c21420b591eef2d9923cc6fe0dd6cd29))
* módulo admin — endpoint GET /api/admin/stats ([230b02f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/230b02f77db63d87910e2fc6baee535a340a5bed))
* módulo de categorías con thumbnails — tabla, CRUD, rutas y JOIN en documentos ([1801c34](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1801c34c83551519f55941b2238682e17451f131))
* monitoreo de errores propio, sin depender de Sentry ([#79](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/79)) ([cc84d5c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/cc84d5c95a926610c28eb17b91a89ad5c7f1f860))
* notificaciones reales de admin/login + reportes de actividad bajo demanda ([#73](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/73)) ([9a283ac](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9a283accb4ac06a64e36affb3ae3e9368da3e10f))
* OpenAPI/Swagger docs + refresh tokens con rotación ([5844ad5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5844ad5ef97c28c9ea6032afa9622a60b5e203db))
* OpenAPI/Swagger docs + refresh tokens con rotación ([78980e1](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/78980e12999fc62409752eadb3000f699ca872c9))
* **ops:** /health verifica conectividad BD — 503 si está caída ([c763b09](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c763b09a659f54d21e4446841b84bbf4305749a1))
* PATCH /usuarios/me — actualizar nombre e institución del perfil propio ([34cd465](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/34cd4653e095a4f3f2ba0d8975bd1e17aaa01419))
* PUT /documentos/:id — endpoint de actualización de documentos ([3971796](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3971796c47e3b9ccf24e2d04e54bc0bfbce0037d))
* **quality:** auditoría de calidad — performance, funcionalidad, API y observabilidad ([b19f6c6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b19f6c6318b20b9dffd238db47c5f9b2175d563b))
* **quality:** completar plataforma — tests de integración, API consistente y correcciones finales ([d727c0e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d727c0e56d65514aea59f0faa1f49712c3de6eb0))
* R2 dual-bucket, superadmin, VIGI-IIAP brand y seguridad integral ([2e3afb5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2e3afb5db6531ae98af73ca27b67ee6b61f5713a))
* rediseña la plantilla de los correos con la paleta real de marca ([#74](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/74)) ([0bfd2c1](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0bfd2c1bf0dd6d03b6d2666a7bc5573817e9580f))
* reporte semanal automático real + limpieza de infra muerta ([#77](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/77)) ([f66b123](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f66b123ed1bd90f996315479241713963f7ef094))
* security hardening — helmet/CSP/CORS estricto, RLS, admin script, supabase migrations ([40f87e6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/40f87e6b8230d134925575a86a9994e101fdcce3))
* **security:** 2FA TOTP — setup, verify, disable, login de dos pasos, backup codes ([374b090](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/374b090d9385fdecc630ef67e4445294c1fc5ff2))
* seguridad integral — custodia de datos, validación de archivos y revocación JWT ([8019eca](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8019ecaac558e402208dff481412e8a3f5d8072d))
* **sentry:** integración Sentry + render.yaml + env vars ([db732f1](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/db732f1f53bb2ac00cf51adeb29ab15a86a32c12))
* **sentry:** integración Sentry + render.yaml + env vars ([5b8151d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5b8151d41225d7a5a43ccee53ae793d833a93d85))
* **solicitudes:** adjuntos R2, email confirmación + 318 tests ([02aedcf](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/02aedcfc411a1db831fb76e03f50340bdd1dbf71))
* **solicitudes:** adjuntos R2, email recibida + tests completos ([2bda09b](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2bda09ba8997cf9d6360fb40b95b1542f2fec03b))
* **solicitudes:** máquina de estados + GET por ID + rate limit ([61042ef](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/61042ef5b76846dee950ea2c1a6573d867e8594d))
* **solicitudes:** máquina de estados + GET por ID + rate limit + días pendiente ([a600e49](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a600e49ddf4f89679d23e18c0194cd9dac0ad57e))
* soporte de dos buckets R2 — privado para PDFs, público para media ([bee692c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/bee692cc0af044d8528b9aaa5284832fc4686ced))
* soporte para despliegue en servidor propio (sin AWS/Supabase/R2) ([#71](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/71)) ([15959d6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/15959d6ed317f94da18d4e62b68de99f0a403871))
* **t1:** Foundation — 9 gaps de seguridad y calidad cerrados ([6e3bf86](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/6e3bf867c05eee35c2d13704e7d7a6091980b194))
* **t2:** email queue BullMQ + session management API + nodemailer CVE fix ([b3eb8d9](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b3eb8d9b2aa5dde477bfe7b684e1cf3888c53738))
* **t2:** Robustness — soft deletes, email queue, sessions API, OpenAPI completa ([22bf46e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/22bf46e1c747aa9aaf1fc275d394ea6c774f0d88))
* **t2:** X-Response-Time + audit log categorias + OpenAPI spec completa (32 paths) ([dac5e08](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/dac5e0831d96ae162abb2d451581fab11fefdc94))
* **t3:** Advanced — 2FA TOTP, cache Redis, exports, password expiry, batch ops ([7749c6c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/7749c6c8c928a68311f65e6f2fa93f88b0b4f66d))
* **t3:** cache Redis TTL + rate limit por usuario + exports CSV/JSON sin dependencias vulnerables ([bddf8eb](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/bddf8eb4244d9c18c5da5e070470cb4ca86b8a31))
* **t3:** password expiry 90d + cambio forzado + batch operations hasta 50 usuarios ([39c0d42](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/39c0d42cefa56d96a1b4a8aa9d341a670bc8fac7))
* **testing:** cobertura backend ≥80% — 691 tests, nuevos endpoints solicitudes ([0eed7c7](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0eed7c70aac765da3e77829dcc8291d26a07dbbf))
* **usuarios:** permite subir foto de perfil real y corrige 2FA nunca reportado ([#58](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/58)) ([0d32f46](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0d32f4620f0ce3801df68cb7f1e1d58df8af3723))
* validación Zod, upload R2, tests y deploy config ([3893158](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/389315853400a5d818b3cd97fc1fe29fa7114dd4))
* visibilidad en módulo mapas ([5912f01](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5912f019b3f58b8fc8d97843e2f1801ecd2c2f81))
* X-Request-Id middleware + schema max lengths (nombre/institucion/motivo/email/descripcion) ([b3d4b3d](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b3d4b3db39b02874c6b7c035179d82a27835b545))


### Bug Fixes

* **2fa:** otplib CJS→ESM via createRequire — corrige crash en producción ([5d81116](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5d811165dcce64aa7439c162c10f8b5ebaee6e65))
* 3 vulnerabilidades refresh token + eslint.config + swagger dep ([bc6a5b4](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/bc6a5b4fcd0f1c79dec0e28d7610da849db786fe))
* actualiza comentario de REDIS_URL en render.yaml ([#78](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/78)) ([8578491](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8578491415068d97ad61a6dc52869ee5214df480))
* **admin,auth:** corrige 500 real en Papelera y evita cierre de sesión por carreras de refresh ([#60](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/60)) ([283c439](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/283c439adf4535490a3311da4a274cf4cdcd3b39))
* agregar handlers globales de unhandledRejection/uncaughtException ([#67](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/67)) ([4b53529](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/4b53529472a6f8a9dfa023d579f44670d550bc39))
* **api:** error format { error } en controllers + validación ENV de email al arrancar ([e75c253](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e75c2530bd3f9355d86e21edd04899bbbd922e69))
* audit follow-up hardening (registro audit log, solicitudes race guard, role-change session revocation, login rate limit defense-in-depth) ([#54](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/54)) ([bd2f05c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/bd2f05c9da85f964e1e2f6cc7f6e73fa044e0ebb))
* aumentar límite thumbnail a 50 MB en backend ([3c2b006](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3c2b006e60d0010da11d1a5aae3fe7a1f7133ff5))
* **auth:** corrige el path de la cookie de refresh — causaba cierre de sesión a los 15 minutos ([#49](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/49)) ([a6d3bb5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a6d3bb5bb4fc8628ce4673ff918b8add69513c8c))
* authorize() — super_admin acceso absoluto incondicional a todas las rutas ([7eeff37](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/7eeff37e701bddcc66ce947e55c3c11fc7779d57))
* **auth:** SameSite=None para cookie cross-origin (frontend y backend en subdominios distintos de onrender.com) ([e80fcc3](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e80fcc39b1c03d41080a1918db59c1dbdfb92fff))
* **auth:** unifica el shape del usuario en login/2fa-confirm con /auth/me ([#65](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/65)) ([ab57fde](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/ab57fde95b106721ad8b9f2a1e1a2f50d7a4b94b))
* **auth:** validación fuerte de contraseña y emails con logging explícito ([c81ce42](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c81ce42ef83680c10f2b4c36943ea7bf6da0630b))
* block admin_sig self-escalation in crearUsuario and whitelist config booleans ([#50](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/50)) ([84f5ab5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/84f5ab5f6a40c9c48f6f883ad67f01f4a5b87242))
* cerrar acceso a recursos en papelera, validar activo y limitar mail-bombing ([#85](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/85)) ([d877451](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d877451625a7adebdf39aac1aa7b5847ed596e47))
* **ci:** agrega swagger-ui-express a package.json (faltaba en la rama) ([dd9d34e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/dd9d34e372df83e102888a6ab637cc825067e94a))
* cierra huecos de seguridad y bug de build en deploy.yml ([#88](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/88)) ([ad13171](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/ad131713dcbb495c5819d81dd195a1bc4d87e5b3))
* **ci:** eslint.config.js para ESLint 9 + mocks de auth.service tests tras refresh tokens ([15a1bab](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/15a1baba40327326deb2c1960096dbce875f08cb))
* **ci:** release-please — skip PR creation (GitHub Actions no tiene permisos de PR) ([511ce6e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/511ce6e401a6c1e3da3b8fddf71f34e1715dca6a))
* **ci:** restaura @eslint/js en devDependencies ([8026a57](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8026a57c3e838de7c7101ab3b538e91fad73d83f))
* **config:** vitest excluye .claude/ + helmet 8 — remueve xssFilter y contentTypeOptions deprecados ([b9123b9](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b9123b981a05a93bb74a371f27347b492fa5606e))
* cookies de sesion SameSite=Lax en vez de None ([#90](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/90)) ([079da2e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/079da2e3604c54ce0b98391cee4859da1deee9f2))
* corregir flujo completo de verificación de email y gaps en módulos ([1d94e1e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1d94e1ed7f67811394b12096f2c05eaee1aa11cb))
* corrige tests desactualizados tras actualización de schema y firma de servicio ([0532907](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/053290747a35c574e8efe977a47de8e2e1be7278))
* **cors:** agrega X-CSRF-Token a allowedHeaders — bloqueaba todo guardado en producción ([#59](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/59)) ([f742e55](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f742e55c7303d21562e23d11d90ba695ab722fe8))
* **critical:** reemplaza otplib v13 roto con otpauth — servidor arranca de nuevo ([472c24f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/472c24f3b1707d31b461698636bb48fd5b8c43e5))
* **db:** elimina RLS sobre spatial_ref_sys — tumbaba el arranque en cada deploy ([#46](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/46)) ([70e302e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/70e302eed84cb7390904bb0751cfdb9f50aae174))
* **db:** rejectUnauthorized false por defecto en producción — Supabase usa CA propia ([037d298](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/037d298b23d3cb1ab352007dee39030a0ab07cce))
* **deploy:** rateLimiter IPv6 — normalizeIp() para express-rate-limit v8 ([b829715](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b829715fa90e24e89740568e2e3a0b1ed4ca614f))
* elimina notifyNuevoInicioSesion duplicada en mailer.js ([#75](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/75)) ([09d4ef4](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/09d4ef4779db74e3ca07e5a334d4a010f3e661a7))
* eliminar archivos de R2 al borrar mapa + hard delete real ([a9dab0c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a9dab0cf512ea0966667a109ec5442b74b686a67))
* enforce Roles y Permisos toggles instead of leaving them decorative ([#57](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/57)) ([320a117](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/320a11786874f1488ae2c71844731624be846d1c))
* exportar optionalAuthenticate en auth middleware ([9501bfb](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9501bfb34ef331ea00f894a193e413618ba0e93a))
* hard delete + R2 cleanup en documentos y noticias; migración 006 incluida; visibilidad y schemas ([f013acc](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f013acc4a26c9e400cfdcb4a3b95c13952669a07))
* **internal:** 12 tests corregidos + email configurable + cache categorías ([#38](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/38)) ([0377e16](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0377e16ba5dac93a98fd4bb3c0d5df65d157a665))
* **migration:** 021 usa nombre en lugar de id para índice de categorias ([3bbd87f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3bbd87f1f1910a3397f8583d7624a9f850d07efc))
* motivo opcional, perfil→rol en registro, activar usuario separado de rol ([27b21e3](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/27b21e326e3102a0374135a43edd9a3a75daff0e))
* nombre de repositorio en minusculas para el tag de Docker ([#89](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/89)) ([c936e11](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c936e11438a1dcd8889813d0b48a00c940eaf66f))
* rate limiter never blocked anyone due to ipKeyGenerator(req) misuse ([#53](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/53)) ([015ba66](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/015ba665793cca61a5c56d3c805f5929c970a0ce))
* refresco periódico del modo mantenimiento — no dependía solo de restart ([#72](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/72)) ([ef36003](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/ef3600371d09746abda017167f187ace859fa516))
* renombrar VIGIIAP → VIGI-IIAP en emails y scripts de bootstrap ([e29d025](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e29d025d5430b31c9dcc012560c3b33a6819a977))
* responder 409 claro ante título duplicado en mapas/documentos ([#66](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/66)) ([29737ef](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/29737ef36ac5bc87c351af26fc5024158a8b0610))
* restrict GitHub Actions token permissions to read-only ([#52](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/52)) ([95cbe51](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/95cbe5163e26f9d1f2240fd9f725abdf98254e65))
* restrict maintenance mode config to super_admin only ([#56](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/56)) ([3641a8b](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3641a8ba15bc920f3efc62febaabe66c909e1683))
* **runtime:** ipKeyGenerator helper + CURRENT_YEAR definido — crashes al arrancar en Render ([98e96c0](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/98e96c0fe3936b2ea7d2868c75f98617411d114e))
* **security:** 10 hallazgos críticos/altos de auditoría ([a0e233e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a0e233ea96940dea3dff1228aa24360fe73a1c21))
* **security:** 10 hallazgos críticos/altos de auditoría ([51a157c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/51a157cf6732ef47d7ffd266892b1e9ec79935c3))
* **security:** 20 hallazgos de auditoría — hardening nivel producción ([8f0a17b](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/8f0a17b930b17c093cb2a780ea8514188b40ca21))
* **security:** 20 hallazgos de auditoría — hardening nivel producción ([ffe90f8](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/ffe90f8bbdc04f1e94d54262c83e2236c27181de))
* **security:** 2FA requerido en cambio forzado de contraseña + batch guards (auto-op + admin_sig escalation) ([9956f02](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9956f02f6d51be29c1cf60c87e77c19a7c9bcaa6))
* **security:** 3 hallazgos del audit de seguridad pre-producción ([48bee23](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/48bee231ce75ff207d074821215a75189ca84ebc))
* **security:** 3 vulnerabilidades en refresh token detectadas por security review ([e02171c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/e02171cc1a9c61f86b08238bf8565fdbf875d4f1))
* **security:** añade protección CSRF explícita en rutas de estado mutante ([#51](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/51)) ([0e75905](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/0e75905edc9dc6d0c3539ab24e705ef373c442ab))
* **security:** auditoría exhaustiva pre-producción — 55 hallazgos corregidos en 4 rondas ([c97b1c9](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c97b1c95ca54c6714966bfa5e264947d399ebb90))
* **security:** auditoría pre-producción — 9 hallazgos corregidos ([5737f34](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5737f344672330f07315b5d5b4cc1eafb25c5c11))
* **security:** Cache-Control no-store + parche CVEs HIGH (brace-expansion, postcss) ([#37](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/37)) ([2fccb7c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2fccb7c9262615329f77050793f389c3da344785))
* **security:** changePassword revoca sesiones activas y blacklistea token actual ([56b24b5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/56b24b582b8abb1b43c500e94ce91cafa23b627b))
* **security:** CSV formula injection — prefijo ' en celdas con =+-@\t\r ([12a642a](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/12a642a5a4747ebb70ff9babee133afb2b72e9ca))
* **security:** cuarta ronda — auditoría completa, todos los hallazgos resueltos ([1b87372](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1b8737242f846cc9a6ef4f670fce0cdf21eca489))
* **security:** endurece RBAC — super_admin invisible, escalada horizontal y roles no verificados ([ca26e26](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/ca26e267242c2affbb326c77ac2118eda707d755))
* **security:** habilita RLS en 11 tablas expuestas vía PostgREST + ín… ([#41](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/41)) ([c3dfdf7](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c3dfdf7c150b2e7a80420d1bc58a347ceb2ada6e))
* **security:** hallazgos de auditoría — LIKE escape, rate limit email, audit log y validación env ([407c145](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/407c14531c122a102aa93b36f9c12a6da2558692))
* **security:** hardening completo — crypto, XSS, SSL, JWT, proxy, deps ([c5148de](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c5148de3e912bbf1e2fc84b6d04c9d5fa4f4522b))
* **security:** hardening completo + JWT cookie HttpOnly ([b528482](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b528482b888d3ba7bc00a2560cd6fcbe392c52f7))
* **security:** hardening completo + JWT cookie HttpOnly ([#10](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/10)) ([b528482](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/b528482b888d3ba7bc00a2560cd6fcbe392c52f7))
* **security:** oculta super_admin completamente de la vista admin_sig ([5b818f6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5b818f6e65c56469b78ab6c2cbb9d0b2af4714d7))
* **security:** roles en endpoints y visibilidad de contenido ([c8bb4c2](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c8bb4c26e399eb3cc35e82c5c34f3efc61cb097f))
* **security:** scope separation en JWT 2FA + guard en setupTotp contra overwrite ([d0bd7cb](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d0bd7cba14262e167825f1650330fee454a6c24a))
* **security:** segunda ronda de auditoría — 23 hallazgos adicionales corregidos ([7a178a1](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/7a178a1fc31e2889ad52acc205e22453462ef626))
* **security:** tercera ronda de auditoría — 18 hallazgos adicionales corregidos ([7da8731](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/7da873185070f62d1ea5b1706e3eb3ba1f3e5314))
* **startup:** valida CORS_ORIGIN al arrancar — falla rápido si hay orígenes inválidos ([346378c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/346378c101cf75def7faf3c5e3ab1a8a0a40e711))
* **startup:** valida también las variables del bucket R2 público ([#64](https://github.com/JanuarAsprilla/VIGIIAP-backend/issues/64)) ([bc64584](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/bc64584f29959428df4155de902f7f502c8879a7))
* tipos de solicitud sincronizados con el frontend ([451ede9](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/451ede9aea26a2924ce34b0180c4577dd946f5ca))
* verificación email y roles tecnico/institucional ([72af576](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/72af576a7b4fdf225a58ea9ca5fa33122b29013a))
