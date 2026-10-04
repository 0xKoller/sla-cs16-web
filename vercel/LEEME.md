# Dirección linda con Vercel

Vercel no puede correr el juego (las salas necesitan un servidor prendido todo el tiempo y
tráfico UDP), pero sirve de **puerta de entrada** con una dirección fácil, por ejemplo
`https://slagames.vercel.app`: muestra la página del servidor real y el navegador se
conecta directo a él para jugar y bajar los archivos.

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importá este repositorio.
2. **Project Name:** el nombre que quieras en la dirección (por ejemplo `slagames`).
3. **Root Directory:** `vercel` · **Framework Preset:** Other · sin comandos de build.
4. **Deploy**.

Si cambia la dirección del servidor del juego, editá `destination` en `vercel.json` y
subilo: Vercel se actualiza solo con cada cambio en GitHub.
