#!/bin/sh
# Arranca las salas: un servidor dedicado de CS 1.6 por cada línea de /config/salas.conf
#   id | nombre | mapa | jugadores | bots | dificultad
# La sala N (en orden) escucha en 127.0.0.1:27015+N*10. Si no hay salas.conf, arranca
# una sola sala con MAPA, MAX_JUGADORES, BOTS y BOTS_DIFICULTAD.
set -eu

MAPA="${MAPA:-de_dust2}"
MAX_JUGADORES="${MAX_JUGADORES:-12}"
BOTS="${BOTS:-0}"
BOTS_DIFICULTAD="${BOTS_DIFICULTAD:-0}"
NOMBRE_SERVIDOR="${NOMBRE_SERVIDOR:-CS 1.6}"
SALAS_CONF="${SALAS_CONF:-/config/salas.conf}"
RAIZ_SALAS="${RAIZ_SALAS:-/home/xash/salas}"

recortar() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
numero() { # numero <valor> <por defecto> <mín> <máx>
  case "$1" in
    ''|*[!0-9]*) printf '%s' "$2" ;;
    *) if [ "$1" -lt "$3" ]; then printf '%s' "$3"; elif [ "$1" -gt "$4" ]; then printf '%s' "$4"; else printf '%s' "$1"; fi ;;
  esac
}

# Una línea normalizada por sala: id|nombre|mapa|jugadores|bots|dificultad|puerto
# (mismas reglas que web/salas.mjs)
listar_salas() {
  n=0
  vistos=" "
  if [ -s "$SALAS_CONF" ]; then
    sed -e '/^[[:space:]]*#/d' "$SALAS_CONF"
  fi | while IFS='|' read -r id nombre mapa max bots dif _resto; do
    id=$(recortar "${id:-}")
    [ -n "$id" ] || continue
    case "$id" in *[!A-Za-z0-9_-]*) continue ;; esac
    [ "${#id}" -le 16 ] || continue
    case "$vistos" in *" $id "*) continue ;; esac
    vistos="$vistos$id "
    [ "$n" -lt 16 ] || break
    nombre=$(recortar "$(printf '%s' "${nombre:-}" | tr -d '"\\;' | cut -c1-60)")
    [ -n "$nombre" ] || nombre="Sala $id"
    mapa=$(recortar "${mapa:-}")
    case "$mapa" in ''|*[!A-Za-z0-9_.-]*) mapa="$MAPA" ;; esac
    max=$(numero "$(recortar "${max:-}")" "$MAX_JUGADORES" 2 32)
    bots=$(numero "$(recortar "${bots:-}")" "$BOTS" 0 31)
    dif=$(numero "$(recortar "${dif:-}")" "$BOTS_DIFICULTAD" 0 4)
    printf '%s|%s|%s|%s|%s|%s|%s\n' "$id" "$nombre" "$mapa" "$max" "$bots" "$dif" $((27015 + n * 10))
    n=$((n + 1))
  done
}

# Para las pruebas: solo mostrar cómo se leyó salas.conf
if [ "${SOLO_LISTAR_SALAS:-0}" = 1 ]; then
  listar_salas
  exit 0
fi

cd /opt/xash

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
SIN_BOTS=0
problema=$(falta_algo cstrike/dlls/yapb.so)
if [ -n "$problema" ]; then
  echo "Aviso: los bots (YaPB) no se pueden cargar; las salas siguen sin bots." >&2
  echo "$problema" >&2
  SIN_BOTS=1
fi

# Prepara la carpeta de una sala: el motor y la lógica de CS son compartidos (enlaces),
# la configuración, los bots y los mapas de la comunidad son propios de cada sala.
preparar_sala() { # preparar_sala <dir> <nombre> <bots> <dificultad>
  dir=$1
  mkdir -p "$dir/cstrike/addons/yapb/conf" "$dir/valve"
  for f in /opt/xash/*; do                # motor y bibliotecas (enlaces)
    if [ -f "$f" ]; then ln -sf "$f" "$dir/"; fi
  done
  ln -sfn /opt/xash/cstrike/dlls "$dir/cstrike/dlls"
  ln -sf /opt/xash/cstrike/extras.pk3 "$dir/cstrike/extras.pk3"
  ln -sf /opt/xash/valve/extras.pk3 "$dir/valve/extras.pk3"
  # Configuración (la genera start.sh a partir de config/server.cfg.template)
  sed -e "s/^hostname .*/hostname \"$2\"/" /config/server.cfg > "$dir/cstrike/server.cfg"
  cp /config/mapcycle.txt "$dir/cstrike/mapcycle.txt"
  # Mensaje de bienvenida (texto plano: el cliente web no muestra HTML)
  if [ -f /config/motd.txt ]; then cp /config/motd.txt "$dir/cstrike/motd.txt"; fi
  touch "$dir/cstrike/listip.cfg" "$dir/cstrike/banned.cfg"
  # Mapas y archivos de la comunidad (carpeta mapas/ del proyecto, misma forma que cstrike/)
  if [ -d /mapas ]; then
    (cd /mapas && find . -type f ! -name '.*' | while read -r f; do
      case "$f" in
        ./*/*) ;;                       # adentro de una carpeta: va
        *.md|*.txt) continue ;;         # LEEME.md y similares de la raíz: no
      esac
      case "$f" in *.dll|*.so|*.dylib|*.exe) continue ;; esac   # nada de código
      mkdir -p "$dir/cstrike/$(dirname "$f")"
      cp "$f" "$dir/cstrike/$f"
    done)
  fi
  # Bots YaPB: un yapb.cfg suelto tiene prioridad sobre el que viene en extras.pk3
  if unzip -p /opt/xash/cstrike/extras.pk3 addons/yapb/conf/yapb.cfg > "$dir/yapb.cfg" 2>/dev/null; then
    sed -e "s/^yb_quota \".*\"/yb_quota \"$3\"/" \
        -e "s/^yb_difficulty \".*\"/yb_difficulty \"$4\"/" \
        "$dir/yapb.cfg" > "$dir/cstrike/addons/yapb/conf/yapb.cfg"
  fi
}

correr_sala() { # correr_sala <id> <mapa> <jugadores> <puerto>  (en la carpeta de la sala)
  sin_bots=$SIN_BOTS
  while :; do
    if [ "$sin_bots" = 0 ]; then
      set -- "$1" "$2" "$3" "$4" -dll dlls/yapb.so
    else
      set -- "$1" "$2" "$3" "$4"
    fi
    id=$1 mapa=$2 max=$3 puerto=$4
    shift 4
    inicio=$(date +%s)
    set +e
    XASH3D_BASEDIR="$PWD" /opt/xash/xash3d -dedicated -game cstrike "$@" -rodir /juego -port "$puerto" -noip6 -dev 1 \
      +ip 127.0.0.1 +sv_lan 1 +maxplayers "$max" +map "$mapa" < /dev/null
    codigo=$?
    set -e
    duro=$(( $(date +%s) - inicio ))
    # YaPB usa instrucciones SIMD; si el emulador no las soporta y se cae al arrancar,
    # la sala sigue sin bots en vez de quedar en un bucle de reinicios.
    if [ "$sin_bots" = 0 ] && [ "$codigo" -ge 128 ] && [ "$duro" -lt 60 ]; then
      echo "!! La sala $id se cayó al arrancar con bots (código $codigo). Sigue sin bots." >&2
      sin_bots=1
    else
      echo "!! La sala $id terminó (código $codigo). La vuelvo a arrancar en 3 segundos." >&2
      sleep 3
    fi
    set -- "$id" "$mapa" "$max" "$puerto"
  done
}

LISTA=$(listar_salas)
if [ -z "$LISTA" ]; then
  LISTA="1|$NOMBRE_SERVIDOR|$MAPA|$MAX_JUGADORES|$BOTS|$BOTS_DIFICULTAD|27015"
fi

trap 'kill 0 2>/dev/null; exit 0' INT TERM
mkdir -p "$RAIZ_SALAS"
# (con «done <<FIN» el bucle corre en este mismo shell: así «wait» espera a las salas)
while IFS='|' read -r id nombre mapa max bots dif puerto; do
  echo "== Sala $id: «$nombre» · $mapa · hasta $max jugadores · $bots bots · puerto $puerto"
  preparar_sala "$RAIZ_SALAS/$id" "$nombre" "$bots" "$dif"
  (cd "$RAIZ_SALAS/$id" && correr_sala "$id" "$mapa" "$max" "$puerto" 2>&1 | sed -u "s/^/[sala $id] /") &
done <<FIN
$LISTA
FIN
wait
