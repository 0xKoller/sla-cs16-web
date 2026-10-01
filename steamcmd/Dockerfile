# SteamCMD oficial de Valve, para bajar los archivos del juego (servidor dedicado de
# Half-Life, app 90, con Counter-Strike). Es gratis y no necesita cuenta de Steam.
FROM --platform=linux/386 debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/steam steam \
 && mkdir -p /home/steam/steamcmd /descarga \
 && chown -R steam:steam /home/steam /descarga

USER steam
WORKDIR /home/steam/steamcmd
RUN curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar xz

ENTRYPOINT ["./steamcmd.sh"]
