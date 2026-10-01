#!/bin/sh
# Arranca el servidor dedicado. Variables: MAPA, MAX_JUGADORES, BOTS, BOTS_DIFICULTAD.
set -eu
cd /opt/xash

MAPA="${MAPA:-de_dust2}"
MAX_JUGADORES="${MAX_JUGADORES:-12}"
BOTS="${BOTS:-0}"
BOTS_DIFICULTAD="${BOTS_DIFICULTAD:-0}"

if [ ! -f /juego/valve/delta.lst ] || [ ! -d /juego/cstrike/maps ]; then
  echo "Faltan los archivos del juego en /juego (build/juego). Corré ./start.sh para bajarlos." >&2
  sleep 30
  exit 1
fi

# ¿Se pueden cargar la lógica de CS y los bots en este sistema?
falta_algo() { # falta_algo <biblioteca> -> imprime el problema si no se puede cargar
  salida=$(/lib/ld-linux.so.2 --list "$1" 2>&1) || true
  case "$salida" in
    *"not found"*|*"No such file"*|*"cannot"*) printf '%s\n' "$salida" | grep -E "not found|No such|cannot" ;;
  esac
}
problema=$(falta_algo cstrike/dlls/cs.so)
if [ -n "$problema" ]; then
  echo "ERROR: no se puede cargar la lógica de CS (cs.so):" >&2
  echo "$problema" >&2
  sleep 30
  exit 1
fi
problema=$(falta_algo cstrike/dlls/yapb.so)
if [ -n "$problema" ]; then
  echo "Aviso: los bots (YaPB) no se pueden cargar; el servidor sigue sin bots." >&2
  echo "$problema" >&2
  touch /tmp/sin-bots
fi

# Configuración (la genera start.sh a partir de config/server.cfg.template)
cp /config/server.cfg cstrike/server.cfg
cp /config/mapcycle.txt cstrike/mapcycle.txt
touch cstrike/listip.cfg cstrike/banned.cfg

# Bots YaPB: un yapb.cfg suelto tiene prioridad sobre el que viene en extras.pk3
mkdir -p cstrike/addons/yapb/conf
if unzip -p cstrike/extras.pk3 addons/yapb/conf/yapb.cfg > /tmp/yapb.cfg 2>/dev/null; then
  sed -e "s/^yb_quota \".*\"/yb_quota \"$BOTS\"/" \
      -e "s/^yb_difficulty \".*\"/yb_difficulty \"$BOTS_DIFICULTAD\"/" \
      /tmp/yapb.cfg > cstrike/addons/yapb/conf/yapb.cfg
fi

arrancar() {
  # $1 = con o sin bots
  if [ "$1" = "con-bots" ]; then
    set -- -dll dlls/yapb.so
  else
    set --
  fi
  ./xash3d -dedicated -game cstrike "$@" -rodir /juego -port 27015 -noip6 -dev 1 \
    +ip 127.0.0.1 +sv_lan 1 +maxplayers "$MAX_JUGADORES" +map "$MAPA"
}

# YaPB usa instrucciones SIMD; si el emulador no las soporta y se cae al arrancar,
# se sigue sin bots en vez de quedar en un bucle de reinicios.
if [ ! -f /tmp/sin-bots ]; then
  inicio=$(date +%s)
  set +e
  arrancar con-bots
  codigo=$?
  set -e
  duro=$(( $(date +%s) - inicio ))
  if [ "$codigo" -ge 128 ] && [ "$duro" -lt 60 ]; then
    echo "!! El servidor se cayó al arrancar con bots (código $codigo). Sigo sin bots." >&2
    touch /tmp/sin-bots
  else
    exit "$codigo"
  fi
fi
exec ./xash3d -dedicated -game cstrike -rodir /juego -port 27015 -noip6 -dev 1 \
  +ip 127.0.0.1 +sv_lan 1 +maxplayers "$MAX_JUGADORES" +map "$MAPA"
