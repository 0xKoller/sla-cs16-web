#!/usr/bin/env bash
# Apaga el juego y el estudio. Tus texturas (texturas/) y lo armado (build/) quedan.
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh
docker_listo || falla "Docker no está andando, así que no hay nada que apagar."
docker compose down
ok "Todo apagado. Para volver a levantarlo: ./start.sh"
