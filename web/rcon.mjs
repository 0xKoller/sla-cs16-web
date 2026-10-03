// Manda un comando de consola a una sala de CS:
//   node rcon.mjs "changelevel de_inferno"          (primera sala)
//   node rcon.mjs --sala 2 "yb add"                 (sala 2)
//   node rcon.mjs --todas "say Hola a todos"        (todas las salas)
import { rcon } from './consulta.mjs';
import { cargarSalas } from './salas.mjs';

const args = process.argv.slice(2);
let salaId = null;
let todas = false;
if (args[0] === '--sala') {
    salaId = args[1];
    args.splice(0, 2);
} else if (args[0] === '--todas') {
    todas = true;
    args.shift();
}
const cmd = args.join(' ').trim();
const password = (process.env.RCON_PASSWORD || '').trim();
if (!cmd) {
    console.log('Uso: node rcon.mjs [--sala ID | --todas] "<comando>"   (ej.: changelevel de_inferno, yb add, status)');
    process.exit(1);
}
if (!password) {
    console.error('Falta RCON_PASSWORD.');
    process.exit(1);
}
const salas = cargarSalas(process.env.SALAS || '/config/salas.conf');
const elegidas = todas ? salas : [salas.find((s) => s.id === salaId) || salas[0]];
if (salaId && !salas.some((s) => s.id === salaId)) {
    console.error(`No hay una sala "${salaId}". Salas: ${salas.map((s) => s.id).join(', ')}`);
    process.exit(1);
}
for (const s of elegidas) {
    const out = await rcon(s.puerto, password, cmd, cmd.startsWith('status') ? 900 : 600);
    if (elegidas.length > 1) process.stdout.write(`--- sala ${s.id} (${s.nombre})\n`);
    process.stdout.write(out || '(el servidor no respondió nada)\n');
}
