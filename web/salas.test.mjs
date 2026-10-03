// node --test web/salas.test.mjs
// La web (salas.mjs) y el servidor (servidor/entrypoint.sh) tienen que leer config/salas.conf
// igual: si no, un jugador podría terminar en otra sala (otro puerto).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarSalas, leerSalas } from './salas.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = path.join(AQUI, '..', 'servidor', 'entrypoint.sh');

const EJEMPLO = `# comentario
# id | nombre | mapa | jugadores | bots | dificultad
1 | SLA #1 · Clásico | de_dust2 | 12 | 4 | 0

mala id! | no | de_x | 1 | 1 | 1
1 | duplicada | de_inferno | 10 | 0 | 0
2 | SLA #2 "rotación" ; | de_inferno; rm -rf | 99 | 40 | 9
   3|||||
cs_4 | Oficina | cs_office | 2 | 0 | 2
`;

const porDefecto = { mapa: 'de_dust2', maxJugadores: 12, bots: 0, dificultad: 0 };

test('lee salas, ignora comentarios, ids malos y repetidos, acota números', () => {
    const s = leerSalas(EJEMPLO, porDefecto);
    assert.deepEqual(s.map((x) => x.id), ['1', '2', '3', 'cs_4']);
    assert.equal(s[0].nombre, 'SLA #1 · Clásico');            // el # del nombre no es comentario
    assert.equal(s[1].nombre, 'SLA #2 rotación');
    assert.equal(s[1].mapa, 'de_dust2');                       // mapa raro -> el de siempre
    assert.deepEqual([s[1].maxJugadores, s[1].bots, s[1].dificultad], [32, 31, 4]);
    assert.equal(s[2].nombre, 'Sala 3');
    assert.deepEqual(s.map((x) => x.puerto), [27015, 27025, 27035, 27045]);
});

test('sin archivo: una sala con los valores de .env', () => {
    const s = cargarSalas('/no/existe.conf', { nombre: 'Mi server', mapa: 'de_nuke', maxJugadores: 10 });
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].nombre, s[0].mapa, s[0].maxJugadores, s[0].puerto], ['Mi server', 'de_nuke', 10, 27015]);
});

test('el servidor (entrypoint.sh) lee lo mismo que la web', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salas-'));
    const archivo = path.join(dir, 'salas.conf');
    fs.writeFileSync(archivo, EJEMPLO);
    const salida = execFileSync('sh', [ENTRYPOINT], {
        env: { ...process.env, SOLO_LISTAR_SALAS: '1', SALAS_CONF: archivo, MAPA: 'de_dust2', MAX_JUGADORES: '12', BOTS: '0', BOTS_DIFICULTAD: '0' },
        encoding: 'utf8',
    }).trim().split('\n');
    const web = leerSalas(EJEMPLO, porDefecto)
        .map((s) => [s.id, s.nombre, s.mapa, s.maxJugadores, s.bots, s.dificultad, s.puerto].join('|'));
    assert.deepEqual(salida, web);
});
