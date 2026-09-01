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

CMD ["node", "--import", "./src/instrument.js", "server.js"]
