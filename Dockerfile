FROM node:20-alpine AS base
WORKDIR /app

# Crear usuario no-root antes de instalar dependencias.
# Si el contenedor es comprometido, el atacante queda limitado al usuario 'appuser'
# sin privilegios de root — reduce el radio de daño en una fuga de contenedor.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Instalar dependencias de producción como root (acceso a npm cache), luego ceder
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY src ./src
COPY server.js ./
COPY db ./db
COPY scripts ./scripts

# Transferir propiedad de los archivos al usuario no-root
RUN chown -R appuser:appgroup /app

# Cambiar a usuario sin privilegios para el proceso principal
USER appuser

EXPOSE 4000

ENV NODE_ENV=production

# Migraciones antes de servir tráfico: db/migrate.js es idempotente (tabla
# _migraciones), así que correrlo en cada arranque es seguro. Si una migración
# nueva falla, el contenedor no llega a levantar el servidor — el healthcheck
# lo marca como caído en vez de servir con un esquema a medio aplicar.
CMD ["sh", "-c", "node db/migrate.js && node server.js"]
