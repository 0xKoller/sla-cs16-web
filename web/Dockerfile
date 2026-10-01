# Página del juego + puente WebRTC <-> UDP (Node). Corre con la arquitectura de la compu.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY *.mjs ./
COPY public ./public

# extras.pk3 de CS16Client para el navegador (menús, sonidos de bots...). Es grande, por
# eso se baja acá en vez de venir en el proyecto: copia fija de CSweb, verificada.
ARG EXTRAS_URL=https://raw.githubusercontent.com/santiagoPostacchini/CSweb/9dd1703b7e1f53de97f03d53e4b10a902d63c9be/vendor/cs16-client/cstrike/extras.pk3
ARG EXTRAS_SHA256=49d5e00ce50ed01aace3a1c2035a2959c3f7e4457ca2b6c31d01e4cd2a7a5d69
RUN node -e "const fs=require('fs'),c=require('crypto');(async()=>{const r=await fetch(process.argv[1]);if(!r.ok)throw new Error('descarga '+r.status);const b=Buffer.from(await r.arrayBuffer());const h=c.createHash('sha256').update(b).digest('hex');if(h!==process.argv[2])throw new Error('sha256 distinto: '+h);fs.writeFileSync('public/assets/extras-CECzBvGu.pk3',b);console.log('extras.pk3 ok',b.length)})().catch(e=>{console.error(e.message);process.exit(1)})" "$EXTRAS_URL" "$EXTRAS_SHA256"

# Ajustes al cliente (controles táctiles, tecla de consola, «Jugar» espera al servidor).
RUN node parche-cliente.mjs public

USER node
ENV NODE_ENV=production
CMD ["node", "servidor.mjs"]
