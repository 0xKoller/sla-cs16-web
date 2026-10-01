#!/usr/bin/env bash
# Manda un comando a la consola del servidor de CS:
#   ./servidor.sh "yb add"                    agrega un bot      ("yb kick" saca uno)
#   ./servidor.sh "yb_quota 8"                cantidad fija de bots
#   ./servidor.sh "changelevel de_inferno"    cambia el mapa
#   ./servidor.sh status                      lista jugadores
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh
docker_listo || falla "Docker no está andando. Corré ./start.sh primero."
if [ $# -eq 0 ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi
docker compose exec -T web node rcon.mjs "$*"
