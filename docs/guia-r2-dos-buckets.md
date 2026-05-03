# Guía: Configurar dos buckets en Cloudflare R2

**Cuándo hacer esto:** Antes de llevar a producción el PR `feat/VIG-016-r2-two-buckets`.  
**Tiempo estimado:** 15–20 minutos.  
**Requiere:** Acceso al dashboard de Cloudflare + acceso a las variables de entorno del servidor.

---

## Por qué dos buckets

| Bucket | Archivos | Acceso |
|--------|----------|--------|
| `vigiiap-files` (ya existe) | PDFs cartográficos, documentos de investigación | **Privado** — solo accesible por URL prefirmada de 120s generada por la API |
| `vigiiap-files-public` (nuevo) | Thumbnails, imágenes de mapas, fotos de noticias | **Público** — URL directa permanente, puede verse en el navegador sin autenticación |

Esto garantiza que un documento marcado como `acreditados` o `usuarios` no pueda ser descargado por alguien que simplemente tiene la URL directa.

---

## Paso 1 — Crear el bucket público

1. Ir a **dash.cloudflare.com** → tu cuenta → **R2 Object Storage**
2. Clic en **Create bucket**
3. Nombre: `vigiiap-files-public`
4. Región: la misma que `vigiiap-files` (o `APAC` si no recuerdas — Cloudflare elige automáticamente el más cercano)
5. Clic en **Create bucket**

### Conectar un dominio público al bucket

1. Dentro del bucket recién creado → pestaña **Settings**
2. Sección **Public Access** → **Allow Access** o **Connect custom domain**
3. Conectar el dominio: `media.vigiiap.iiap.gov.co` (o `cdn.vigiiap.iiap.gov.co`)
   - Si no tienes el DNS en Cloudflare, usa la URL `pub-XXXXX.r2.dev` que Cloudflare asigna
4. Verificar que **Public Access** muestre **Enabled**

---

## Paso 2 — Deshabilitar el acceso público en el bucket privado

1. Ir al bucket `vigiiap-files` (el que ya existe)
2. Pestaña **Settings** → sección **Public Access**
3. Si hay un dominio conectado (ej. `files.vigiiap.iiap.gov.co`), clic en **Remove**
4. Verificar que diga **Public access is disabled**

### Verificar que funcionó

```bash
# Debe responder 403 Forbidden o Access Denied
curl -I https://files.vigiiap.iiap.gov.co/mapas/pdf/cualquier-archivo.pdf
```

---

## Paso 3 — Verificar permisos del API token

El token que usa la API (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`) necesita acceso a **ambos** buckets.

1. En R2 → **Manage R2 API Tokens**
2. Abrir el token activo
3. Confirmar que tiene permiso **Object Read & Write** en:
   - `vigiiap-files`
   - `vigiiap-files-public`

Si solo cubre un bucket, editar y agregar el segundo, o crear un nuevo token con ambos.

---

## Paso 4 — Agregar variables de entorno al servidor

### En Render (o Railway)

Agregar estas dos variables al servicio del backend:

```
R2_PUBLIC_BUCKET_NAME=vigiiap-files-public
R2_PUBLIC_BUCKET_URL=https://media.vigiiap.iiap.gov.co
```

> Si usaste la URL `pub-XXXXX.r2.dev` en lugar de dominio propio, pon esa URL en `R2_PUBLIC_BUCKET_URL`.

### En `.env` local (para desarrollo)

```env
R2_PUBLIC_BUCKET_NAME=vigiiap-files-public
R2_PUBLIC_BUCKET_URL=https://media.vigiiap.iiap.gov.co
```

---

## Paso 5 — Mergear el PR y desplegar

1. Esperar que el CI pase en el PR `feat/VIG-016-r2-two-buckets`
2. Mergear a `develop`
3. Cuando estés listo para producción: PR `develop → main`
4. El servidor se actualiza automáticamente en Render/Railway

---

## Cómo queda el flujo después

```
Subida de thumbnail → bucket vigiiap-files-public → URL directa permanente
Subida de imagen de mapa → bucket vigiiap-files-public → URL directa permanente
Subida de PDF → bucket vigiiap-files → URL privada en BD

Descarga PDF (acreditados) → GET /api/descargar/mapa/:id → verifica token JWT → genera URL prefirmada 120s → redirect
Descarga PDF (público) → GET /api/descargar/mapa/:id → genera URL prefirmada 120s → redirect
Thumbnail en frontend → URL directa del bucket público → sin pasar por API
```

---

## Si algo sale mal

| Síntoma | Causa probable | Solución |
|---------|---------------|---------|
| Thumbnails no cargan | `R2_PUBLIC_BUCKET_URL` mal configurada | Verificar que la URL en `.env` coincide exactamente con el dominio configurado en el bucket |
| PDFs dan 403 al descargar | API token sin acceso al bucket privado | Revisar permisos del token en Cloudflare |
| Nuevos uploads van al bucket equivocado | `R2_PUBLIC_BUCKET_NAME` no está definida en el servidor | Agregar la variable de entorno y reiniciar el servicio |
| Archivos viejos (ya subidos) no funcionan | Los archivos existentes siguen en el bucket original | Los archivos antiguos no se mueven automáticamente — siguen funcionando igual que antes |

> **Nota sobre archivos existentes:** Los PDFs que ya están en `vigiiap-files` cuando era público siguen siendo accesibles por URL directa hasta que el bucket se vuelva privado. Solo los nuevos uploads irán al bucket correcto automáticamente. Los archivos viejos no necesitan moverse — el endpoint de descarga los sirve correctamente por presigned URL.
