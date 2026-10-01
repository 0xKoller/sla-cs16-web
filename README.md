# CS 1.6 propio (web)

Counter-Strike 1.6 que se juega desde el navegador, más un **estudio de personajes**
para cambiarles las texturas y ver el resultado en 3D antes de probarlo en el juego.

Por ahora está armado para correr **solo en tu compu**. Cuando los personajes estén
como querés, el siguiente paso es configurarlo para jugar online con más gente.

## Qué necesitás

- **Docker Desktop** ([docker.com](https://www.docker.com/products/docker-desktop/)).
  En una Mac con chip M elegí la versión "Apple Silicon". Es gratis para uso personal.
- Unos 2 GB libres de disco.

## Arrancar

Abrí la Terminal en esta carpeta y corré:

```bash
./start.sh
```

La primera vez tarda unos minutos: baja el servidor (~600 MB), copia los archivos del
juego y arma todo. Las siguientes veces arranca en segundos. Cuando termina muestra:

- **Juego:** http://localhost:27016 — poné un nombre, elegí equipo y jugá. Si el servidor
  trae bots, entran 4 para que veas a los personajes moverse.
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
4. Tocá **«Aplicar al juego»** y recargá la pestaña del juego.

Detalles a tener en cuenta:

- Cada textura tiene un tamaño fijo (por ejemplo 256×256). Si subís otro tamaño, el
  estudio lo ajusta solo, pero conviene respetarlo.
- El motor usa 256 colores por textura. El estudio convierte tu imagen automáticamente;
  lo que ves en el 3D ya es cómo va a quedar en el juego.
- Solo se cambian texturas: la forma del personaje y dónde pegan los tiros no cambian.
- «Restaurar original» vuelve una textura (o el modelo entero) a como venía.

También hay atajos para la terminal:

```bash
./texturas.sh lista                  # modelos que se pueden editar
./texturas.sh exportar player/leet   # copia las texturas a texturas/personajes/leet/
./texturas.sh aplicar                # aplica tus cambios al juego
```

## Dentro del juego

- La consola se abre con la tecla que está a la izquierda del 1 (`` ` `` o `~`).
- `thirdperson` / `firstperson`: ver a tu propio personaje en tercera persona.
- Para manejar el servidor desde la consola: `rcon_password <la de .env>` y después,
  por ejemplo, `rcon bot_add`, `rcon bot_kick` o `rcon changelevel de_inferno`.

## Seguridad

- En modo local (el de siempre) **todo escucha solo en tu compu** (127.0.0.1): nadie de
  tu red ni de internet puede entrar.
- `./start.sh lan` abre el juego a tu red local (Wi-Fi). El estudio sigue siendo solo
  para tu compu en cualquier modo.
- Las contraseñas (RCON) se generan al azar la primera vez y quedan en `.env`, que solo
  puede leer tu usuario. `.env`, `build/` y `texturas/` no se comparten si subís este
  proyecto a git.
- Los contenedores corren con permisos mínimos y límites de memoria. El estudio no
  acepta pedidos que vengan de otras páginas web.

## Si algo falla

- **«Docker no está instalado»**: instalá Docker Desktop y abrilo una vez.
- **El juego se queda cargando**: esperá a que termine la primera descarga (~200 MB
  dentro del navegador) y recargá. Si sigue, mirá `docker compose logs game`.
- **Entro al juego pero no conecta**: probá con `./start.sh lan`; algunos navegadores
  no conectan WebRTC a 127.0.0.1.
- **No veo mis cambios**: ¿tocaste «Aplicar al juego»? Después recargá la pestaña del
  juego.

## Cómo está armado

| Parte | Qué hace |
|---|---|
| `game` | Servidor de CS 1.6 + cliente web ([Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs) en WebAssembly, imagen `yohimik/cs-web-server`). |
| `proxy` | nginx: sirve `valve.zip` con tus personajes y pasa el resto al juego. |
| `studio` | El estudio (Python). Lee las texturas de los `.mdl`, arma `build/valve.zip`. |

Los archivos originales del juego quedan en `build/base/` y nunca se modifican. Tus
cambios viven en `texturas/` y se aplican sobre copias.

## Aviso

Counter-Strike, Half-Life y su contenido son de Valve. Este proyecto no está afiliado a
Valve; los archivos del juego vienen dentro de la imagen del servidor y no se incluyen en
este repositorio. Es para uso privado entre amigos: antes de abrirlo al público hay que
revisar el tema de los derechos.
