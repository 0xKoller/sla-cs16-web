# Mapas de la comunidad

Todo lo que pongas acá se suma al juego: a cada sala del servidor y a los jugadores
(que lo bajan junto con el paquete de la comunidad, `mod.zip`).

La carpeta tiene la **misma forma que `cstrike/`** del juego:

```
mapas/
  maps/de_mimapa.bsp        el mapa
  maps/de_mimapa.txt        (opcional) descripción que se ve al cargar
  de_mimapa.wad             texturas, si el mapa usa un .wad aparte
  sound/ambience/...        sonidos propios, si los tiene
  gfx/env/...               cielo propio, si lo tiene
```

Para que el mapa aparezca en una sala, ponelo como mapa en `config/salas.conf` o
sumalo a `config/mapcycle.txt`, y corré `./start.sh`.

## Antes de mandar un mapa (pull request)

- Tiene que ser **tuyo o con una licencia que permita compartirlo** (decilo en el PR,
  con el link a la fuente y la licencia). Nada sacado de juegos comerciales.
- Nada de archivos de Valve (los mapas oficiales ya los tiene cada jugador).
- Nada de código (`.dll`, `.so`, `.exe`): no se aceptan.
- Probalo en una sala antes de mandarlo.
