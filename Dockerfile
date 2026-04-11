FROM node:20-alpine AS base
WORKDIR /app

# Instalar dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY src ./src
COPY server.js ./
COPY db ./db

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "server.js"]
