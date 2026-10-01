# Servidor dedicado de CS 1.6: Xash3D FWGS + ReGameDLL_CS + bots YaPB (todo open source).
# Los archivos del juego (mapas, modelos, sonidos) se montan en /juego (solo lectura).

# ---- 1. Bajar los binarios oficiales (Linux 32 bits) ----------------------------
FROM --platform=linux/386 debian:bookworm-slim AS descarga

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl binutils \
 && rm -rf /var/lib/apt/lists/*

# Versiones probadas (ver FUENTES.txt). Si los "continuous" ya cambiaron, se usa la
# versión nueva igual y se avisa en el armado.
ARG XASH_URL=https://github.com/FWGS/xash3d-fwgs/releases/download/continuous/xash3d-fwgs-linux-i386.tar.gz
ARG XASH_SHA256=b58a244014f29ea5ac2c1b130f34fa9569f4a8b417ee49dc684184b282e4bb45
ARG CS_URL=https://github.com/Velaron/cs16-client/releases/download/continuous/CS16Client-Linux-i386.tar.gz
ARG CS_SHA256=a1e4e887fee92b946859562162c1257a70b2329798319e52e46d7a7d6aea38c8

WORKDIR /tmp/dl
COPY preparar-motor.sh ./
RUN sh preparar-motor.sh

# ---- 2. Imagen final ------------------------------------------------------------
FROM --platform=linux/386 debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/xash xash

COPY --from=descarga /tmp/dl/motor/ /opt/xash/
COPY entrypoint.sh /usr/local/bin/servidor-cs
RUN chmod 755 /usr/local/bin/servidor-cs /opt/xash/xash3d \
 && chown -R xash:xash /opt/xash

USER xash
WORKDIR /opt/xash
ENV LD_LIBRARY_PATH=/opt/xash
ENTRYPOINT ["/usr/local/bin/servidor-cs"]
