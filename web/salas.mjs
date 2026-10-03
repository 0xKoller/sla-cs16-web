// Salas (servidores de CS) que corren en esta máquina. Se leen de config/salas.conf:
//
//   # id | nombre                 | mapa      | jugadores | bots | dificultad
//   1    | SLA #1 · Clásico      | de_dust2  | 12        | 4    | 0
//
// Cada sala es un servidor dedicado aparte que escucha en 127.0.0.1, en el puerto
// 27015 + (número de orden) * 10. El mismo archivo lo lee servidor/entrypoint.sh.
import fs from 'node:fs';

export const PUERTO_BASE = 27015;

const ID_VALIDO = /^[a-z0-9_-]{1,16}$/i;
const MAPA_VALIDO = /^[a-z0-9_.-]{1,64}$/i;

export function leerSalas(texto, porDefecto = {}) {
    const salas = [];
    const vistos = new Set();
    for (const cruda of texto.split(/\r?\n/)) {
        const linea = cruda.trim();
        if (!linea || linea.startsWith('#')) continue;   // comentarios: líneas que empiezan con #
        const [id, nombre, mapa, jugadores, bots, dificultad] = linea.split('|').map((c) => c.trim());
        if (!ID_VALIDO.test(id || '') || vistos.has(id)) continue;
        vistos.add(id);
        const num = (v, d, min, max) => {
            const n = Number.parseInt(v, 10);
            return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d;
        };
        salas.push({
            id,
            nombre: (nombre || '').replace(/["\\;]/g, '').slice(0, 60).trim() || `Sala ${id}`,
            mapa: MAPA_VALIDO.test(mapa || '') ? mapa : (porDefecto.mapa || 'de_dust2'),
            maxJugadores: num(jugadores, porDefecto.maxJugadores ?? 12, 2, 32),
            bots: num(bots, porDefecto.bots ?? 0, 0, 31),
            dificultad: num(dificultad, porDefecto.dificultad ?? 0, 0, 4),
            puerto: PUERTO_BASE + salas.length * 10,
        });
        if (salas.length >= 16) break;
    }
    return salas;
}

// Si no hay archivo, una sola sala con los valores de .env (como antes de las salas)
export function cargarSalas(ruta, porDefecto = {}) {
    let texto = '';
    try {
        texto = fs.readFileSync(ruta, 'utf8');
    } catch { /* sin archivo */ }
    const salas = leerSalas(texto, porDefecto);
    if (salas.length) return salas;
    return [{
        id: '1',
        nombre: porDefecto.nombre || 'CS 1.6',
        mapa: porDefecto.mapa || 'de_dust2',
        maxJugadores: porDefecto.maxJugadores ?? 12,
        bots: porDefecto.bots ?? 0,
        dificultad: porDefecto.dificultad ?? 0,
        puerto: PUERTO_BASE,
    }];
}
