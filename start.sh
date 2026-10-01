#!/usr/bin/env bash
# Levanta el CS 1.6 web propio y el estudio de personajes.
#
#   ./start.sh         modo local: solo se puede entrar desde esta compu (recomendado)
#   ./start.sh lan     también pueden entrar otros dispositivos de tu red (Wi-Fi)
#
# La primera vez arma las imágenes de Docker y baja los archivos del juego (unos
# minutos); las siguientes arranca en segundos.
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh
. scripts/bajar-juego.sh

MODO="${1:-local}"
case "$MODO" in
  local|lan) ;;
  -h|--help|ayuda) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

servidor_en_linea() {
  curl -fsS "http://$DIR:27016/api/status" 2>/dev/null | grep -q '"serverOnline":true'
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
[ -n "$(env_get NOMBRE_SERVIDOR)" ] || env_set NOMBRE_SERVIDOR "CS 1.6 propio"
[ -n "$(env_get MAPA)" ] || env_set MAPA "de_dust2"
[ -n "$(env_get MAX_JUGADORES)" ] || env_set MAX_JUGADORES "12"
[ -n "$(env_get BOTS)" ] || env_set BOTS "4"
[ -n "$(env_get BOTS_DIFICULTAD)" ] || env_set BOTS_DIFICULTAD "0"
env_del GAME_IMAGE
env_del GAME_IP

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
env_set IP_PUBLICA "$DIR"
env_set URL_JUEGO "http://$HOST_URL:27016"
env_set HOST_UID "$(id -u):$(id -g)"

NOMBRE_SED=$(env_get NOMBRE_SERVIDOR | tr -d '"\\/&;')
sed -e "s/{{RCON}}/$(env_get RCON_PASSWORD)/" -e "s/{{CHEATS}}/$TRAMPAS/" -e "s/{{NOMBRE}}/$NOMBRE_SED/" \
  config/server.cfg.template > config/server.cfg.tmp
mv config/server.cfg.tmp config/server.cfg
chmod 644 config/server.cfg
mkdir -p build texturas
ok "Configuración lista (contraseñas en .env)"

# ---------------------------------------------------------------- 3. Imágenes
paso "Armando las imágenes de Docker (la primera vez tarda unos minutos)"
docker compose build servidor web studio || falla "No pude armar las imágenes. Revisá tu conexión a internet y volvé a correr ./start.sh"
ok "Imágenes listas"

# ------------------------------------------------- 4. Archivos del juego (1 vez)
bajar_juego

# ------------------------------------------------------------- 5. valve.zip
paso "Armando el paquete del juego con tus personajes"
docker compose run --rm --no-deps studio python -m app.cli build || falla "No pude armar valve.zip."

# ------------------------------------------------------------- 6. Levantar
paso "Levantando el servidor"
docker compose up -d --remove-orphans servidor web studio

if ! esperar 90 "La página del juego responde" curl -fsS -o /dev/null "http://$DIR:27016/api/status"; then
  docker compose logs --tail 40 servidor web || true
  falla "La página del juego no responde. Arriba están los últimos mensajes."
fi
esperar 60 "El estudio responde" curl -fsS -o /dev/null "http://127.0.0.1:27080/api/status" \
  || aviso "El estudio todavía no responde; mirá «docker compose logs studio»."
printf '  … esperando que el servidor de CS cargue el mapa (en una Mac con chip M puede tardar un par de minutos)\n'
if ! esperar 300 "El servidor de CS está en línea" servidor_en_linea; then
  docker compose logs --tail 40 servidor || true
  aviso "El servidor de CS todavía no responde. Puede seguir cargando: mirá «docker compose logs -f servidor»."
fi

URL_J=$(env_get URL_JUEGO)
printf '\n  %s✅ Listo%s\n\n' "$_B" "$_N"
printf '  Juego:    %s\n' "$URL_J"
printf '  Estudio:  http://localhost:27080   (solo desde esta compu)\n'
if [ "$MODO" = "lan" ]; then
  printf '\n  Pasale el link del juego a quien esté en tu misma red.\n'
fi
printf '\n  Comandos del servidor:  ./servidor.sh "yb add"   ./servidor.sh "changelevel de_inferno"\n'
printf '  Para apagar todo:       ./stop.sh\n\n'
