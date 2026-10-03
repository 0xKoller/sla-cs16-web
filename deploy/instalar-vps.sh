#!/usr/bin/env bash
# Instala y levanta el juego online en un servidor alquilado (VPS) recién creado.
# Probado para Ubuntu 22.04 / 24.04 y Debian 12, en procesadores x86_64 (Intel/AMD).
#
# Con el repo ya clonado en el servidor:
#   sudo ./deploy/instalar-vps.sh                  # usa <tu-ip>.sslip.io como dominio
#   sudo ./deploy/instalar-vps.sh juego.midominio.com
#
# O directo desde GitHub (cambiá shugavibes/sla-cs16-web):
#   curl -fsSL https://raw.githubusercontent.com/shugavibes/sla-cs16-web/main/deploy/instalar-vps.sh \
#     | sudo REPO=https://github.com/shugavibes/sla-cs16-web.git bash -s -- [dominio]
#
# Qué hace: instala Docker y git, abre solo los puertos necesarios (SSH, 80, 443 y
# 27018/UDP), agrega memoria de intercambio si el servidor tiene poca, y corre
# ./start.sh online. Se puede volver a correr sin problema (por ejemplo, para actualizar).
set -euo pipefail

DOMINIO="${1:-}"
REPO="${REPO:-}"
DESTINO="${DESTINO:-/opt/cs16-web}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
falla() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falla "Corrélo con sudo (necesita instalar programas y abrir puertos)."
command -v apt-get >/dev/null 2>&1 || falla "Este instalador es para Ubuntu o Debian."

say "1/6 Programas base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw >/dev/null

say "2/6 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || falla "Docker quedó sin «docker compose». Instalá el paquete docker-compose-plugin."

case "$(uname -m)" in
  x86_64|amd64) ;;
  aarch64|arm64)
    echo "Procesador ARM: el servidor de CS es de 32 bits x86 y va a correr emulado (más lento)."
    docker run --privileged --rm tonistiigi/binfmt --install 386,amd64 >/dev/null
    ;;
  *) falla "Procesador $(uname -m) no soportado." ;;
esac

say "3/6 Código del juego"
if [ -f "$(dirname "$0")/../start.sh" ] && [ -z "$REPO" ]; then
  cd "$(dirname "$0")/.."
else
  [ -n "$REPO" ] || falla "No encuentro el proyecto. Pasá REPO=https://github.com/shugavibes/sla-cs16-web.git"
  if [ -d "$DESTINO/.git" ]; then
    git -C "$DESTINO" pull --ff-only
  else
    git clone --depth 1 "$REPO" "$DESTINO"
  fi
  cd "$DESTINO"
fi
echo "Proyecto en $(pwd)"

say "4/6 Firewall: solo SSH, web (80/443) y juego (27018/UDP)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw allow 27018/udp >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/  /'

say "5/6 Memoria"
memoria_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$memoria_mb" -lt 3000 ] && ! swapon --show | grep -q .; then
  echo "El servidor tiene ${memoria_mb} MB: agrego 2 GB de memoria de intercambio."
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "${memoria_mb} MB: alcanza."
fi

say "6/6 Levantando el juego (la primera vez tarda: baja ~600 MB de archivos del juego)"
./start.sh online ${DOMINIO:+"$DOMINIO"}
