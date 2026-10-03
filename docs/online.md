# Jugar online: cómo está armado y cómo subirlo

## La idea en una imagen

```
                  internet                                  tu servidor (VPS)
 ┌──────────────┐                     ┌──────────────────────────────────────────────────┐
 │  navegador   │  HTTPS (443)        │  caddy ──► web (Node)                             │
 │  del jugador │ ──────────────────► │            · página del juego (WebAssembly)       │
 │              │                     │            · /api/salas, /game/mod.zip            │
 │  motor de CS │  WebRTC (UDP 27018) │            · puente WebRTC ⇄ UDP                  │
 │  en Wasm     │ ◄─────────────────► │                 │        │        │              │
 │              │                     │                 ▼        ▼        ▼              │
 │  sus propios │                     │            sala 1    sala 2    sala N            │
 │  archivos de │                     │            :27015    :27025    :27015+N*10       │
 │  CS 1.6      │                     │         (servidores dedicados de CS 1.6,         │
 └──────────────┘                     │          solo escuchan dentro del servidor)      │
                                      └──────────────────────────────────────────────────┘
```

- **Salas.** Cada línea de `config/salas.conf` es un servidor de CS aparte, con su mapa,
  cupo y bots. Corren todas en el contenedor `servidor` y escuchan solo en `127.0.0.1`:
  desde afuera no se las puede tocar.
- **Web.** Sirve la página, avisa el estado de cada sala (`/api/salas`) y hace de puente:
  el navegador habla WebRTC (un canal sin orden ni reenvíos, que se comporta como UDP) y
  la web lo pasa a la sala elegida. Cada jugador entra con su propia IP de loopback, así
  la sala los distingue.
- **Caddy.** Pone HTTPS automático (Let's Encrypt). Hace falta: sin HTTPS el navegador no
  deja usar la cámara (control con la mano) y algunas cosas de WebRTC.
- **Un solo puerto para el juego.** Todo el tráfico de juego entra por UDP 27018, sin
  importar cuántas salas haya.

## Archivos del juego: por qué en público cada uno usa los suyos

Los mapas, modelos y sonidos de Counter-Strike son de Valve. Repartirlos desde una página
pública es redistribuir su contenido (proyectos parecidos fueron dados de baja por eso).
Por eso hay dos modos, que se eligen con `ARCHIVOS` en `.env`:

| Modo | Qué baja el jugador | Para qué |
|---|---|---|
| `propios` (por defecto en online) | Solo `mod.zip`: lo propio de la comunidad (personajes con el logo, marca, mapas nuevos). Los archivos de CS 1.6 los elige una vez desde su compu (la carpeta «Half-Life» de Steam) y quedan guardados en su navegador. **No se suben a ningún lado.** | Servidores públicos |
| `servidor` (por defecto en local y LAN) | Todo el juego (`valve.zip`), desde el servidor. | Tu compu, tu casa, o un grupo privado: en online solo se permite con contraseña (`CONTRASENA=` en `.env`), que también protege la descarga |

El servidor sí necesita los archivos del juego para correr las salas: los baja con
SteamCMD, la herramienta oficial y gratuita de Valve para servidores dedicados.

## Subirlo a internet, paso a paso

Hace falta un servidor alquilado (VPS) con Linux. Con 2 CPU y 4 GB de memoria alcanzan
4 salas con bots cómodas.

| Proveedor | Plan de ejemplo | Precio aproximado |
|---|---|---|
| Hetzner Cloud | CX22 (2 vCPU x86, 4 GB) | ~4 € por mes |
| DigitalOcean | Basic 2 GB / 4 GB | 12-24 US$ por mes |
| Vultr / Linode | 2-4 GB | 10-20 US$ por mes |

Elegí un plan **x86 (Intel/AMD)**: el servidor de CS es de 32 bits x86 y en ARM corre
emulado. Cerca de los jugadores mejor (para Argentina: San Pablo o Miami andan bien).

1. **Crear el servidor** con Ubuntu 24.04 y tu clave SSH.
2. **Entrar** por SSH: `ssh root@IP_DEL_SERVIDOR`
3. **Instalar y levantar** (cambiá USUARIO/REPO por el repo de GitHub):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/USUARIO/REPO/main/deploy/instalar-vps.sh \
     | sudo REPO=https://github.com/USUARIO/REPO.git bash
   ```

   Instala Docker, abre solo los puertos que hacen falta (SSH, 80, 443 y 27018/UDP),
   baja los archivos del juego y arranca dos salas. Al final muestra el link: si no
   pasaste un dominio, usa `https://IP-CON-GUIONES.sslip.io`, que apunta a tu servidor
   sin configurar nada.
4. **(Opcional) Dominio propio**, por ejemplo `juego.slatv.live`: creá un registro DNS
   tipo **A** que apunte a la IP del servidor y corré, en la carpeta del proyecto
   (`/opt/cs16-web`):

   ```bash
   sudo ./start.sh online juego.slatv.live
   ```

### Si el proveedor tiene firewall propio

Algunos (Hetzner, AWS, Google Cloud, Oracle) tienen un firewall aparte del servidor.
Abrí ahí también: **TCP 22, 80, 443** y **UDP 443, 27018**.

## Administrar

En la carpeta del proyecto en el servidor:

```bash
./servidor.sh status                         # quién está jugando (sala 1)
./servidor.sh --sala 2 "changelevel de_nuke"   # cambiar el mapa de la sala 2
./servidor.sh --todas "say Reinicio en 5 minutos"
docker compose logs -f servidor web          # ver qué pasa
git pull && ./start.sh online                # actualizar a la última versión
```

- **Agregar salas:** editá `config/salas.conf` y corré `./start.sh online`.
- **Personajes y marca:** el estudio queda solo en el servidor. Para usarlo desde tu
  compu: `ssh -L 27080:localhost:27080 root@IP` y abrí http://localhost:27080.
- **Mapas nuevos:** van en `mapas/` (ver `mapas/LEEME.md`).

## Crecer: más jugadores, más servidores

- **Más salas en el mismo servidor:** cada una usa ~150 MB de memoria y poca CPU; con
  bots, más. Subí `SERVIDOR_MEMORIA` en `.env` si agregás muchas.
- **Varios servidores** (por ejemplo, uno en San Pablo y otro en Miami): cada uno es una
  instalación igual a esta, con su dominio. Cada página muestra sus salas; una lista
  común de servidores (que lea `/api/salas` de cada uno) es el próximo paso natural.
- **Redes que bloquean UDP** (algunas oficinas): ahí WebRTC necesita un servidor TURN
  (por ejemplo `coturn`) escuchando en TCP 443. No viene armado todavía.

## Seguridad

- Las salas solo escuchan dentro del servidor; la contraseña de RCON se genera al azar.
- La web limita las conexiones por IP (`MAX_POR_IP`, 4 por defecto) y el cupo de cada
  sala; detrás de Caddy usa la IP real del jugador.
- Los contenedores corren sin privilegios, con sistema de archivos de solo lectura
  (salvo lo necesario) y límites de memoria.
- El estudio nunca se publica: solo escucha en el propio servidor.
