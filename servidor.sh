#!/usr/bin/env bash
# Manda un comando a la consola de una sala de CS (la primera si no decís cuál):
#   ./servidor.sh "yb add"                      agrega un bot      ("yb kick" saca uno)
#   ./servidor.sh --sala 2 "yb_quota 8"         cantidad fija de bots en la sala 2
#   ./servidor.sh "changelevel de_inferno"      cambia el mapa
#   ./servidor.sh --todas "say Hola"            a todas las salas
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh
docker_listo || falla "Docker no está andando. Corré ./start.sh primero."
if [ $# -eq 0 ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi
if [ "$1" = "--sala" ] && [ $# -ge 3 ]; then
  sala=$2
  shift 2
  exec docker compose exec -T web node rcon.mjs --sala "$sala" "$*"
fi
if [ "$1" = "--todas" ]; then
  shift
  exec docker compose exec -T web node rcon.mjs --todas "$*"
fi
exec docker compose exec -T web node rcon.mjs "$*"
