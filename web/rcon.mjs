// Manda un comando de consola al servidor de CS: node rcon.mjs "changelevel de_inferno"
import { rcon } from './consulta.mjs';

const cmd = process.argv.slice(2).join(' ').trim();
const password = (process.env.RCON_PASSWORD || '').trim();
const port = Number(process.env.PUERTO_JUEGO || 27015);
if (!cmd) {
    console.log('Uso: node rcon.mjs "<comando>"   (por ejemplo: changelevel de_inferno, yb add, status)');
    process.exit(1);
}
if (!password) {
    console.error('Falta RCON_PASSWORD.');
    process.exit(1);
}
const out = await rcon(port, password, cmd, cmd.startsWith('status') ? 900 : 600);
process.stdout.write(out || '(el servidor no respondió nada)\n');
