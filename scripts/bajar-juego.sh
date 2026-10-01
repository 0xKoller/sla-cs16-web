# shellcheck shell=bash
# Baja los archivos del juego (mapas, modelos, sonidos) con SteamCMD, la herramienta
# oficial y gratuita de Valve para servidores dedicados. Deja todo en build/juego.
# Lo usa start.sh; no hace falta correrlo a mano.

JUEGO=build/juego
DESCARGA=build/descarga
ARGS_STEAM="+login anonymous +app_set_config 90 mod cstrike +app_update 90 validate +quit"

_completo() { # _completo <carpeta>
  [ -f "$1/valve/delta.lst" ] && [ -f "$1/cstrike/maps/de_dust2.bsp" ] && [ -f "$1/cstrike/liblist.gam" ]
}

juego_listo() { _completo "$JUEGO"; }

bajar_juego() {
  if juego_listo; then
    ok "Los archivos del juego ya están en $JUEGO"
    return 0
  fi
  mkdir -p "$DESCARGA"

  if ! _completo "$DESCARGA"; then
    paso "Bajando los archivos del juego con SteamCMD de Valve (~600 MB, una sola vez)"
    if docker compose --profile descarga build steamcmd; then
      local intento
      for intento in 1 2 3 4; do
        # shellcheck disable=SC2086
        docker compose --profile descarga run --rm steamcmd +force_install_dir /descarga $ARGS_STEAM || true
        _completo "$DESCARGA" && break
        aviso "SteamCMD no terminó (intento $intento de 4). Es normal que falle alguna vez; reintento."
        sleep 3
      done
    fi
  fi

  if ! _completo "$DESCARGA" && [ "$(uname -s)" = "Darwin" ]; then
    aviso "Pruebo con la versión de SteamCMD para Mac."
    local dir="build/steamcmd-mac"
    mkdir -p "$dir"
    if [ ! -x "$dir/steamcmd.sh" ]; then
      curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz | tar xz -C "$dir" || true
    fi
    if [ -x "$dir/steamcmd.sh" ]; then
      local intento
      for intento in 1 2 3; do
        # shellcheck disable=SC2086
        "$dir/steamcmd.sh" +@sSteamCmdForcePlatformType linux +force_install_dir "$PWD/$DESCARGA" $ARGS_STEAM || true
        _completo "$DESCARGA" && break
        sleep 3
      done
    fi
  fi

  if ! _completo "$DESCARGA"; then
    falla "No pude bajar los archivos del juego.
    Probá de nuevo con ./start.sh (SteamCMD a veces falla de a ratos).
    En una Mac con chip M, si el error dice «Bad CPU type», instalá Rosetta con:
        softwareupdate --install-rosetta --agree-to-license
    Otra opción: si tenés CS 1.6 en Steam, copiá las carpetas «valve» y «cstrike» de tu
    instalación a $JUEGO/ y corré ./start.sh otra vez."
  fi

  # Solo se usan los archivos del juego: los binarios de Valve no se ejecutan nunca.
  mkdir -p "$JUEGO"
  rm -rf "$JUEGO/valve" "$JUEGO/cstrike"
  mv "$DESCARGA/valve" "$DESCARGA/cstrike" "$JUEGO/"
  find "$JUEGO" -type f \( -name '*.so' -o -name '*.dll' -o -name '*.dylib' -o -name '*.exe' \) -delete
  rm -rf "$DESCARGA"
  ok "Archivos del juego listos en $JUEGO (no se suben a ningún lado)"
}
