# Página del juego + puente WebRTC <-> UDP (Node). Corre con la arquitectura de la compu.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY *.mjs ./
COPY public ./public

USER node
ENV NODE_ENV=production
CMD ["node", "servidor.mjs"]
