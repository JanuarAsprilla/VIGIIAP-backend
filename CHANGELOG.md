# Changelog

## 1.0.0 (2026-04-20)


### Features

* /admin/notificaciones endpoint + getAdminEmails con fallback ADMIN_EMAIL ([709b61f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/709b61fcec56f4f3bc7cc91583acb38712da4ae8))
* arquitectura base Fase 2 — API REST VIGIIAP ([1e546d8](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1e546d85c1137e57a369aa2fd57cefaea44bc525))
* audit log en mapas, noticias y documentos ([569af7c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/569af7c9c9f93c9105340e890c7a72eeba40fb7c))
* **auth:** verificación de email, recuperación de contraseña y CRUD admin completo ([2122eb4](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/2122eb43cbe11ea454a7ab450e9dd609d5e02f49))
* auto-aplicar migraciones al iniciar + validar env vars R2/JWT en startup ([3b8c3b6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3b8c3b6ecd06abf51ca87636e5aa84f56daa225b))
* configuracion API, strongPassword validation, admin config endpoints ([16189c5](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/16189c58ed9dda39c9152570a4c4255655a42d58))
* documentos — columna tamano_bytes, schema y service actualizados para Word/Excel ([a4da455](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a4da4554dbb08a6f6ed2a1c7e4ffe4f6ef86665f))
* login dual visitante/institucional, emails y auditoría completa ([d317027](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/d31702730855a1c2e2e26906da14cf69811b739e))
* módulo admin — endpoint GET /api/admin/stats ([230b02f](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/230b02f77db63d87910e2fc6baee535a340a5bed))
* PATCH /usuarios/me — actualizar nombre e institución del perfil propio ([34cd465](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/34cd4653e095a4f3f2ba0d8975bd1e17aaa01419))
* PUT /documentos/:id — endpoint de actualización de documentos ([3971796](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3971796c47e3b9ccf24e2d04e54bc0bfbce0037d))
* security hardening — helmet/CSP/CORS estricto, RLS, admin script, supabase migrations ([40f87e6](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/40f87e6b8230d134925575a86a9994e101fdcce3))
* validación Zod, upload R2, tests y deploy config ([3893158](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/389315853400a5d818b3cd97fc1fe29fa7114dd4))
* visibilidad en módulo mapas ([5912f01](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/5912f019b3f58b8fc8d97843e2f1801ecd2c2f81))


### Bug Fixes

* aumentar límite thumbnail a 50 MB en backend ([3c2b006](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/3c2b006e60d0010da11d1a5aae3fe7a1f7133ff5))
* **auth:** validación fuerte de contraseña y emails con logging explícito ([c81ce42](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/c81ce42ef83680c10f2b4c36943ea7bf6da0630b))
* corregir flujo completo de verificación de email y gaps en módulos ([1d94e1e](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/1d94e1ed7f67811394b12096f2c05eaee1aa11cb))
* eliminar archivos de R2 al borrar mapa + hard delete real ([a9dab0c](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/a9dab0cf512ea0966667a109ec5442b74b686a67))
* exportar optionalAuthenticate en auth middleware ([9501bfb](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/9501bfb34ef331ea00f894a193e413618ba0e93a))
* hard delete + R2 cleanup en documentos y noticias; migración 006 incluida; visibilidad y schemas ([f013acc](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/f013acc4a26c9e400cfdcb4a3b95c13952669a07))
* motivo opcional, perfil→rol en registro, activar usuario separado de rol ([27b21e3](https://github.com/JanuarAsprilla/VIGIIAP-backend/commit/27b21e326e3102a0374135a43edd9a3a75daff0e))
