# Dockerfile para backend Node.js - Aromas
FROM node:20-alpine AS base

# Instalar dependencias necesarias para compilación
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
FROM base AS dependencies
RUN npm ci --only=production && npm cache clean --force

# Etapa de construcción
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .

# Etapa de producción
FROM node:20-alpine AS production

WORKDIR /app

# Copiar dependencias de producción
COPY --from=dependencies /app/node_modules ./node_modules

# Copiar código de la aplicación
COPY --from=build /app ./

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Exponer puerto
EXPOSE 3000

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "server.js"]
