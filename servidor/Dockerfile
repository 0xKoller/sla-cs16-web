# Servidor dedicado de CS 1.6: Xash3D FWGS + ReGameDLL_CS + bots YaPB (todo open source).
# Los archivos del juego (mapas, modelos, sonidos) se montan en /juego (solo lectura).
FROM --platform=linux/386 debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/xash xash

COPY --chown=xash:xash motor/ /opt/xash/
COPY entrypoint.sh /usr/local/bin/servidor-cs
RUN chmod 755 /usr/local/bin/servidor-cs /opt/xash/xash3d \
 && chown -R xash:xash /opt/xash

USER xash
WORKDIR /opt/xash
ENV LD_LIBRARY_PATH=/opt/xash
ENTRYPOINT ["/usr/local/bin/servidor-cs"]
