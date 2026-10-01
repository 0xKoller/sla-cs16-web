# SLA · Counter-Strike 1.6 (web)

Counter-Strike 1.6 que se juega desde el navegador, con la marca de
[SLA](https://slatv.live), más un **estudio de personajes** para cambiarles las texturas
y ver el resultado en 3D antes de probarlo en el juego.

Por ahora está armado para correr **solo en tu compu**. Cuando los personajes estén
como querés, el siguiente paso es configurarlo para jugar online con más gente.

## Qué necesitás

- **Docker Desktop** ([docker.com](https://www.docker.com/products/docker-desktop/)).
  En una Mac con chip M elegí la versión "Apple Silicon". Es gratis para uso personal.
- Unos 3 GB libres de disco.

No hace falta tener Counter-Strike ni cuenta de Steam: los archivos del juego se bajan
con SteamCMD, la herramienta gratuita de Valve para servidores dedicados.

## Arrancar

Abrí la Terminal en esta carpeta y corré:

```bash
./start.sh
```

La primera vez tarda bastante (10 a 20 minutos en una Mac con chip M): arma las
imágenes de Docker, baja los archivos del juego (~600 MB) y prepara todo. Las
siguientes veces arranca en un minuto. Cuando termina muestra:

- **Juego:** http://localhost:27016 — poné un nombre, tocá «Jugar» y elegí equipo
  con la tecla M. Entran 4 bots para que veas a los personajes moverse.
- **Estudio:** http://localhost:27080 — para editar los personajes.

Para apagar todo: `./stop.sh`. Tus cambios quedan guardados.

## Editar personajes

En el estudio:

1. Elegí un personaje a la izquierda. Se ve en 3D al medio (podés girarlo con el mouse
   y cambiar la pose).
2. Elegí una de sus texturas a la derecha.
3. Cambiala:
   - **Ajuste rápido:** mové Tono, Saturación y Brillo; se ve en vivo en el 3D.
     Tocá «Guardar ajuste».
   - **Imagen propia:** «Subir imagen» o arrastrá un PNG sobre la textura.
   - **Con tu programa (Photoshop, Figma, Aseprite…):** tocá «Copiar texturas a la
     carpeta», editá los PNG que aparecen en `texturas/personajes/<personaje>/` y
     guardalos con el mismo nombre. Al volver al estudio se actualizan solos.
4. Tocá **«Aplicar al juego»** y recargá la pestaña del juego. El navegador baja de
   nuevo el paquete del juego (una vez por cada cambio aplicado).

Detalles a tener en cuenta:

- Cada textura tiene un tamaño fijo (por ejemplo 256×256). Si subís otro tamaño, el
  estudio lo ajusta solo, pero conviene respetarlo.
- El motor usa 256 colores por textura. El estudio convierte tu imagen automáticamente;
  lo que ves en el 3D ya es cómo va a quedar en el juego.
- Solo se cambian texturas: la forma del personaje y dónde pegan los tiros no cambian.
- «Restaurar original» vuelve una textura (o el modelo entero) a como venía.

Atajos para la terminal:

```bash
./texturas.sh lista                  # modelos que se pueden editar
./texturas.sh exportar player/leet   # copia las texturas a texturas/personajes/leet/
./texturas.sh aplicar                # aplica tus cambios al juego
```

## Dentro del juego

- **M** elegir equipo · **B** comprar · **Tab** puntajes · **Esc** menú.
- **Consola:** la tecla de arriba a la izquierda, al lado del 1 (en teclados en español
  es la de «º»; también sirve la que está al lado del Shift izquierdo).
- Adentro del juego no hay flechita del mouse: hacés clic, el navegador «atrapa» el
  mouse y apuntás con la mira. **Esc** lo suelta.
- `thirdperson` / `firstperson` en la consola: ver a tu propio personaje en tercera persona.
- Para mirar a los otros personajes con calma: elegí «Espectador» en el menú de equipos.

Comandos del servidor desde la terminal:

```bash
./servidor.sh "yb add"                  # agrega un bot ("yb kick" saca uno)
./servidor.sh "yb_quota 8"              # cantidad fija de bots
./servidor.sh "changelevel de_inferno"  # cambia el mapa
./servidor.sh status                    # lista jugadores
```

La cantidad de bots, su dificultad (0 a 4), el mapa inicial y el máximo de jugadores
se cambian en `.env` (BOTS, BOTS_DIFICULTAD, MAPA, MAX_JUGADORES) y se aplican con
`./start.sh`.

## Marca (SLA)

La carpeta `marca/` tiene todo lo de la marca y se ve **sin rearmar nada**:

- `marca/web/`: colores, tipografía (Geist), logo y textos de la página del juego.
  Se ve con solo recargar la página.
- `marca/juego/`: archivos que van tal cual adentro del juego: los colores del menú y
  el color del HUD. Se aplican con «Aplicar al juego» en el estudio (o
  `./texturas.sh aplicar`) y recargando la página.
- `marca/fuente/generar.py`: arma el favicon, los colores del menú y del HUD a partir
  del logo (`marca/web/sla-logo.svg`).

El nombre del servidor está en `.env` (`NOMBRE_SERVIDOR`) y el mensaje de bienvenida
en `config/motd.txt`; esos dos se aplican con `./start.sh`.

## Seguridad

- En modo local (el de siempre) **todo escucha solo en tu compu** (127.0.0.1): nadie de
  tu red ni de internet puede entrar.
- `./start.sh lan` abre el juego a tu red local (Wi-Fi). El estudio sigue siendo solo
  para tu compu en cualquier modo.
- La contraseña de RCON se genera al azar la primera vez y queda en `.env`, que solo
  puede leer tu usuario. `.env`, `build/` y `texturas/` no se comparten si subís este
  proyecto a git.
- Los contenedores corren sin privilegios, con usuarios comunes y límites de memoria.
  El servidor de CS solo escucha dentro de su contenedor. El estudio no acepta
  pedidos que vengan de otras páginas web.
- De los archivos de Valve solo se usan mapas, modelos y sonidos; ningún programa de
  Valve se ejecuta.

## Si algo falla

- **«Docker no está instalado»**: instalá Docker Desktop y abrilo una vez.
- **Falla la descarga de los archivos del juego**: volvé a correr `./start.sh`
  (SteamCMD a veces falla de a ratos). Si tenés CS 1.6 en Steam, también podés copiar
  las carpetas `valve` y `cstrike` de tu instalación a `build/juego/`.
- **El juego dice que no puede conectar**: mirá `docker compose logs servidor web`.
  Si el servidor arrancó bien, probá con `./start.sh lan`.
- **No veo mis cambios**: ¿tocaste «Aplicar al juego»? Después recargá la pestaña.
- **Ver qué está pasando**: `docker compose logs -f servidor` (consola del servidor de CS).

## Cómo está armado

| Parte | Qué hace |
|---|---|
| `servidor` | Servidor dedicado de CS 1.6: [Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs) + [ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS) + bots [YaPB](https://github.com/yapb/yapb), de [CS16Client](https://github.com/Velaron/cs16-client). Linux 32 bits (en Mac corre emulado). |
| `web` | Node: la página del juego (el motor Xash3D en WebAssembly), el paquete `valve.zip` con tus personajes y el puente WebRTC ⇄ UDP hacia el servidor. |
| `studio` | El estudio (Python). Lee las texturas de los `.mdl` y arma `build/valve.zip`. |
| `steamcmd` | Solo para bajar los archivos del juego la primera vez. |
| `marca/` | Logo, colores y textos de SLA para la página y el juego. |

Los archivos del juego quedan en `build/juego/` y nunca se modifican. Tus cambios viven
en `texturas/` y se aplican sobre copias.

## Créditos

- [CSweb](https://github.com/santiagoPostacchini/CSweb) (MIT): el cliente web, el puente
  WebRTC y la configuración del servidor salen de ahí, con cambios para correr en Docker.
- Port WebAssembly de Xash3D y CS16Client: paquetes `xash3d-fwgs` / `cs16-client` de
  webxash3d-fwgs (yohimik, MIT), tomados de la copia guardada en CSweb.
- Detalle de versiones y licencias de los binarios del servidor en `servidor/FUENTES.txt`.
- Tipografía [Geist](https://vercel.com/font) (Vercel, SIL Open Font License 1.1).
- Logo y marca SLA: de SLA, usados con su permiso.

## Aviso

Counter-Strike, Half-Life y su contenido son de Valve. Este proyecto no está afiliado a
Valve y no incluye archivos de Valve: se bajan en tu compu con SteamCMD. Es para uso
privado entre amigos; antes de abrirlo al público hay que revisar el tema de los derechos.
