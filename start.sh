#!/usr/bin/env bash
# Levanta el CS 1.6 web propio y el estudio de personajes.
#
#   ./start.sh         modo local: solo se puede entrar desde esta compu (recomendado)
#   ./start.sh lan     también pueden entrar otros dispositivos de tu red (Wi-Fi)
#
# La primera vez baja las imágenes de Docker (~600 MB) y copia los archivos del
# juego; las siguientes arranca en segundos.
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh

MODO="${1:-local}"
IMAGEN_PROBADA="yohimik/cs-web-server@sha256:ce01d36559ae78446baed1032252b87ee9ec639e4f2f2cdbbdcf75d75359a699"
IMAGEN_ULTIMA="yohimik/cs-web-server:latest"

case "$MODO" in
  local|lan) ;;
  -h|--help|ayuda) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) falla "No conozco el modo «$MODO». Usá ./start.sh (local) o ./start.sh lan" ;;
esac

ip_de_la_red() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  printf '%s' "$ip"
}

esperar() { # esperar <segundos> <descripción> <comando...>
  local limite=$1 que=$2 i=0
  shift 2
  until "$@" >/dev/null 2>&1; do
    i=$((i + 2))
    if [ "$i" -ge "$limite" ]; then return 1; fi
    sleep 2
  done
  ok "$que"
}

# ---------------------------------------------------------------- 1. Docker
paso "Revisando Docker"
if ! command -v docker >/dev/null 2>&1; then
  cat <<'TXT'

  Docker no está instalado. Es lo único que este proyecto necesita.

    1. Bajá Docker Desktop desde https://www.docker.com/products/docker-desktop/
       (en una Mac con chip M elegí "Apple Silicon").
    2. Instalalo, abrilo una vez y aceptá los permisos que pida.
    3. Volvé a correr ./start.sh

TXT
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Darwin" ]; then
    aviso "Docker no estaba abierto; lo abro."
    open -a Docker >/dev/null 2>&1 || true
  fi
  esperar 180 "Docker está andando" docker info || falla "Docker no arrancó. Abrí Docker Desktop a mano, esperá a que diga «running» y volvé a correr ./start.sh"
else
  ok "Docker está andando"
fi
docker compose version >/dev/null 2>&1 || falla "Falta «docker compose». Actualizá Docker Desktop."

# ------------------------------------------------------------ 2. Configuración
paso "Preparando la configuración ($MODO)"
touch .env
chmod 600 .env
[ -n "$(env_get RCON_PASSWORD)" ] || env_set RCON_PASSWORD "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
[ -n "$(env_get GAME_IMAGE)" ] || env_set GAME_IMAGE "$IMAGEN_PROBADA"

if [ "$MODO" = "local" ]; then
  DIR="127.0.0.1"
  HOST_URL="localhost"
  TRAMPAS=1
else
  DIR=$(ip_de_la_red)
  printf '%s' "$DIR" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || falla "No pude averiguar la IP de esta compu en la red. ¿Estás conectado al Wi-Fi?"
  HOST_URL="$DIR"
  TRAMPAS=0
fi
env_set MODO "$MODO"
env_set BIND_ADDR "$DIR"
env_set GAME_IP "$DIR"
env_set URL_JUEGO "http://$HOST_URL:27016"

sed -e "s/{{RCON}}/$(env_get RCON_PASSWORD)/" -e "s/{{CHEATS}}/$TRAMPAS/" \
  config/server.cfg.template > config/server.cfg.tmp
mv config/server.cfg.tmp config/server.cfg
chmod 644 config/server.cfg
mkdir -p build texturas
ok "Contraseñas generadas en .env y config/server.cfg"

# ---------------------------------------------------------------- 3. Imágenes
paso "Bajando las imágenes (la primera vez tarda unos minutos)"
if ! docker compose pull game proxy; then
  if [ "$(env_get GAME_IMAGE)" = "$IMAGEN_PROBADA" ]; then
    aviso "No pude bajar la versión probada del servidor; pruebo con la última publicada."
    env_set GAME_IMAGE "$IMAGEN_ULTIMA"
    docker compose pull game proxy || falla "No pude bajar las imágenes. Revisá tu conexión a internet."
  else
    falla "No pude bajar las imágenes. Revisá tu conexión a internet."
  fi
fi
docker compose build studio || falla "No pude armar la imagen del estudio."
ok "Imágenes listas"

# ------------------------------------------------- 4. Archivos del juego (1 vez)
if [ ! -d build/base/cstrike ] || [ ! -d build/base/valve ]; then
  paso "Copiando los archivos del juego desde la imagen (una sola vez)"
  rm -rf build/base.tmp
  mkdir -p build/base.tmp
  CID=$(docker create --platform linux/386 "$(env_get GAME_IMAGE)")
  trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
  docker cp "$CID:/xashds/valve" build/base.tmp/valve
  docker cp "$CID:/xashds/cstrike" build/base.tmp/cstrike
  docker rm -f "$CID" >/dev/null 2>&1 || true
  trap - EXIT
  [ -d build/base.tmp/cstrike/models ] || falla "La imagen no trae los archivos del juego donde esperaba (/xashds)."
  rm -rf build/base
  mv build/base.tmp build/base
  ok "Archivos copiados a build/base (no se suben a ningún lado)"
fi

# ------------------------------------------------------------- 5. valve.zip
paso "Armando valve.zip con tus personajes"
docker compose run --rm --no-deps studio python -m app.cli build || falla "No pude armar valve.zip."

# ------------------------------------------------------------- 6. Levantar
paso "Levantando el servidor"
docker compose up -d --remove-orphans

URL_PRUEBA="http://$DIR:27016/"
if ! esperar 90 "La página del juego responde" curl -fsS -o /dev/null "$URL_PRUEBA"; then
  docker compose logs --tail 40 game proxy || true
  falla "La página del juego no responde en $URL_PRUEBA. Arriba están los últimos mensajes."
fi
esperar 60 "El estudio responde" curl -fsS -o /dev/null "http://127.0.0.1:27080/api/status" \
  || aviso "El estudio todavía no responde; mirá «docker compose logs studio»."
if esperar 240 "El servidor de CS terminó de arrancar" sh -c 'docker compose logs game 2>&1 | grep -qi "server started"'; then
  :
else
  aviso "No vi el mensaje de arranque del servidor todavía (en Macs con chip M puede tardar más)."
fi

URL_J=$(env_get URL_JUEGO)
printf '\n  %s✅ Listo%s\n\n' "$_B" "$_N"
printf '  Juego:    %s\n' "$URL_J"
printf '  Estudio:  http://localhost:27080   (solo desde esta compu)\n'
if [ "$MODO" = "lan" ]; then
  printf '\n  Pasale el link del juego a quien esté en tu misma red.\n'
fi
printf '\n  Para apagar todo: ./stop.sh\n\n'
