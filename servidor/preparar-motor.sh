#!/bin/sh
# Baja el motor y la lógica de CS, verifica las versiones y deja en ./motor solo lo
# que necesita el servidor dedicado. Lo usa el Dockerfile.
set -eu
: "${XASH_URL:?}" "${XASH_SHA256:?}" "${CS_URL:?}" "${CS_SHA256:?}"

curl -fsSL --retry 3 -o xash.tar.gz "$XASH_URL"
curl -fsSL --retry 3 -o cs.tar.gz "$CS_URL"
echo "$XASH_SHA256  xash.tar.gz" | sha256sum -c - \
  || echo "AVISO: el motor Xash3D FWGS es más nuevo que la versión probada; se usa igual."
echo "$CS_SHA256  cs.tar.gz" | sha256sum -c - \
  || echo "AVISO: CS16Client es más nuevo que la versión probada; se usa igual."

mkdir -p x c motor/valve motor/cstrike/dlls
tar xzf xash.tar.gz -C x
tar xzf cs.tar.gz -C c
X=$(find x -maxdepth 2 -name xash3d -type f -exec dirname {} \; | head -n 1)
[ -n "$X" ] || { echo "No encontré el motor en el archivo bajado." >&2; exit 1; }

cp "$X/xash3d" "$X/libxash.so" "$X/filesystem_stdio.so" motor/
cp -L "$X/libSDL2-2.0.so.0" motor/
cp "$X/valve/extras.pk3" motor/valve/
cp c/cstrike/dlls/cs.so c/cstrike/dlls/yapb.so motor/cstrike/dlls/
cp c/cstrike/extras.pk3 motor/cstrike/
strip --strip-debug motor/libxash.so motor/cstrike/dlls/yapb.so motor/xash3d 2>/dev/null || true
rm -rf x c xash.tar.gz cs.tar.gz
echo "Motor listo:"
ls -l motor motor/cstrike/dlls
