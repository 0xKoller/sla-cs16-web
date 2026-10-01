#!/usr/bin/env bash
# Atajos del estudio desde la terminal:
#   ./texturas.sh lista              modelos que se pueden editar
#   ./texturas.sh exportar <id>      copia las texturas originales a texturas/<modelo>/
#   ./texturas.sh aplicar            aplica tus PNG editados al juego
#   ./texturas.sh estado             muestra si hay cambios sin aplicar
set -euo pipefail
cd "$(dirname "$0")"
. scripts/comun.sh
docker_listo || falla "Docker no está andando. Corré ./start.sh primero."
if [ $# -eq 0 ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi
if docker compose ps --status running --services 2>/dev/null | grep -qx studio; then
  exec docker compose exec studio python -m app.cli "$@"
fi
exec docker compose run --rm --no-deps studio python -m app.cli "$@"
