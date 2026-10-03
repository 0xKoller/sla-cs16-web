// Servidor web del juego: página (cliente Xash3D en WebAssembly), archivos del juego,
// estado de las salas y señalización WebRTC hacia los servidores de CS.
//
// Basado en server/index.mjs y server/http.mjs de CSweb
// (https://github.com/santiagoPostacchini/CSweb, MIT).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RtcBridge } from './rtc.mjs';
import { consultarInfo } from './consulta.mjs';
import { cargarSalas } from './salas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] ?? '').trim() || d;

const cfg = {
    httpPort: Number(env('PUERTO_WEB', '27016')),
    webrtcPort: Number(env('PUERTO_WEBRTC', '27018')),
    publicIp: env('IP_PUBLICA', ''),
    hostname: env('NOMBRE_SERVIDOR', 'CS 1.6'),
    map: env('MAPA', 'de_dust2'),
    maxPlayers: Number(env('MAX_JUGADORES', '12')),
    password: env('CONTRASENA', ''),
    data: env('DATOS', '/data/build'),
    publicDir: env('PUBLICO', path.join(HERE, 'public')),
    // Funciones propias de la página (salas, equipo, archivos propios, manos). Se leen en
    // cada pedido: con la carpeta montada, los cambios se ven al recargar.
    clienteDir: env('CLIENTE', path.join(HERE, 'cliente')),
    // Capa de marca (logo, colores, textos). Opcional; también se lee en cada pedido.
    marcaDir: env('MARCA', '/data/marca/web'),
    salasArchivo: env('SALAS', '/config/salas.conf'),
    // 'servidor': la página manda los archivos del juego (solo para uso privado).
    // 'propios':  cada jugador usa sus archivos de CS 1.6 (servidores públicos).
    archivos: env('ARCHIVOS', 'servidor') === 'propios' ? 'propios' : 'servidor',
    maxPorIp: Number(env('MAX_POR_IP', '4')),
    // Detrás de Caddy (modo online) la IP real del jugador viene en X-Forwarded-For
    confiarProxy: env('CONFIAR_PROXY', '0') === '1',
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.zip': 'application/zip',
    '.pk3': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
};
const SECURITY = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
};

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ------------------------------------------------------------------ salas
const porDefecto = { nombre: cfg.hostname, mapa: cfg.map, maxJugadores: cfg.maxPlayers };
let salas = cargarSalas(cfg.salasArchivo, porDefecto);
let salasMtime = 0;
const estado = new Map(); // id -> { online, map, players, bots }

function recargarSalas() {
    let mtime = 0;
    try {
        mtime = fs.statSync(cfg.salasArchivo).mtimeMs;
    } catch { /* sin archivo */ }
    if (mtime !== salasMtime) {
        salasMtime = mtime;
        salas = cargarSalas(cfg.salasArchivo, porDefecto);
        log(`[web] salas: ${salas.map((s) => `${s.id} (${s.nombre}, puerto ${s.puerto})`).join(', ')}`);
    }
}

function buscarSala(id) {
    return salas.find((s) => s.id === id) || salas[0];
}

async function consultarSalas() {
    recargarSalas();
    await Promise.all(salas.map(async (s) => {
        const info = await consultarInfo(s.puerto);
        const antes = estado.get(s.id)?.online;
        if (info) {
            estado.set(s.id, { online: true, map: info.map || s.mapa, players: info.players, bots: info.bots });
            if (!antes) log(`[juego] sala ${s.id} lista, mapa ${info.map}`);
        } else {
            estado.set(s.id, { online: false, map: s.mapa, players: 0, bots: 0 });
            if (antes) log(`[juego] la sala ${s.id} no responde`);
        }
    }));
}
setInterval(consultarSalas, 5000).unref();
consultarSalas();

// ---------------------------------------------------------------- archivos
function leerJson(archivo, cache) {
    try {
        const st = fs.statSync(archivo);
        if (st.mtimeMs !== cache.mtime) {
            cache.mtime = st.mtimeMs;
            cache.value = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        }
    } catch {
        cache.mtime = 0;
        cache.value = null;
    }
    return cache.value;
}
const cacheAssets = { mtime: 0, value: null };
const cacheMod = { mtime: 0, value: null };
const leerAssets = () => leerJson(path.join(cfg.data, 'assets.json'), cacheAssets);
const leerMod = () => leerJson(path.join(cfg.data, 'mod.json'), cacheMod);

// Lo que el navegador tiene que cargar. En modo 'propios' solo el paquete de la
// comunidad (logo, personajes, mapas nuevos): el resto lo pone cada jugador.
function assetsParaCliente() {
    if (cfg.archivos === 'propios') {
        const mod = leerMod();
        return mod ? { ...mod, propios: true } : null;
    }
    return leerAssets();
}

// Contraseña de la descarga: después de 10 intentos fallidos en 10 minutos, esa IP espera.
const FALLOS_MAX = 10;
const FALLOS_VENTANA = 10 * 60 * 1000;
const fallos = new Map();   // ip -> { n, desde }
function demasiadosFallos(ip) {
    const f = fallos.get(ip);
    if (!f) return false;
    if (Date.now() - f.desde > FALLOS_VENTANA) {
        fallos.delete(ip);
        return false;
    }
    return f.n >= FALLOS_MAX;
}
function anotarFallo(ip) {
    const f = fallos.get(ip);
    if (!f || Date.now() - f.desde > FALLOS_VENTANA) {
        if (fallos.size > 10000) fallos.clear();
        fallos.set(ip, { n: 1, desde: Date.now() });
    } else f.n++;
}

function claveOk(dada) {
    if (!cfg.password) return true;
    const a = Buffer.from(String(dada || ''));
    const b = Buffer.from(cfg.password);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --------------------------------------------------------------------- http
function sendFile(req, res, file, cacheControl, etag) {
    let stat;
    try {
        stat = fs.statSync(file);
        if (!stat.isFile()) throw new Error('no es archivo');
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
        res.end('No encontrado');
        return;
    }
    const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': cacheControl,
        'Last-Modified': stat.mtime.toUTCString(),
        ...SECURITY,
    };
    if (etag) {
        headers.ETag = `"${etag}"`;
        if (req.headers['if-none-match'] === headers.ETag) {
            delete headers['Content-Length'];
            res.writeHead(304, headers);
            res.end();
            return;
        }
    } else if (req.headers['if-modified-since'] === headers['Last-Modified']) {
        delete headers['Content-Length'];
        res.writeHead(304, headers);
        res.end();
        return;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
}

function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...SECURITY });
    res.end(JSON.stringify(data));
}

function sendText(res, status, texto) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
    res.end(texto);
}

const PUBLIC = path.resolve(cfg.publicDir);
const CLIENTE = path.resolve(cfg.clienteDir);
const MARCA = path.resolve(cfg.marcaDir);

function mtimeDe(file) {
    try {
        return Math.floor(fs.statSync(file).mtimeMs).toString(36);
    } catch {
        return null;
    }
}

// Sirve un archivo de una carpeta sin dejar salir de ella
function servirDe(base, rel, req, res, cacheControl = 'no-cache') {
    const archivo = path.resolve(base, rel);
    if (!archivo.startsWith(base + path.sep)) {
        res.writeHead(403, SECURITY);
        res.end();
        return;
    }
    sendFile(req, res, archivo, cacheControl);
}

// index.html + funciones propias (cliente/) + capa de marca, con la fecha de cada
// archivo en la URL para que el navegador no use uno viejo.
function sendIndex(req, res) {
    let html;
    try {
        html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    } catch {
        res.writeHead(404, SECURITY);
        res.end('No encontrado');
        return;
    }
    const cabeza = [];
    const cuerpo = [];
    const v = (archivo) => mtimeDe(archivo);
    const entradaCss = v(path.join(CLIENTE, 'entrada.css'));
    const entradaJs = v(path.join(CLIENTE, 'entrada.js'));
    const marcaCss = v(path.join(MARCA, 'marca.css'));
    const marcaJs = v(path.join(MARCA, 'marca.js'));
    const icono = v(path.join(MARCA, 'favicon.svg'));
    if (icono) html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="/marca/favicon.svg?v=${icono}">`);
    if (entradaCss) cabeza.push(`<link rel="stylesheet" href="/cliente/entrada.css?v=${entradaCss}">`);
    if (marcaCss) cabeza.push(`<link rel="stylesheet" href="/marca/marca.css?v=${marcaCss}">`);
    if (marcaJs) cuerpo.push(`<script type="module" src="/marca/marca.js?v=${marcaJs}"></script>`);
    if (entradaJs) cuerpo.push(`<script type="module" src="/cliente/entrada.js?v=${entradaJs}"></script>`);
    html = html.replace('</head>', `${cabeza.join('\n')}\n</head>`).replace('</body>', `${cuerpo.join('\n')}\n</body>`);
    const body = Buffer.from(html);
    res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        ...SECURITY,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
}

function datosSala(s) {
    const e = estado.get(s.id) || { online: false, map: s.mapa, players: 0, bots: 0 };
    return {
        id: s.id,
        nombre: s.nombre,
        mapa: e.map,
        jugadores: Math.max(e.players - e.bots, 0),
        bots: e.bots,
        max: s.maxJugadores,
        web: bridge.contarSala(s.id),
        online: e.online,
    };
}

function handler(req, res) {
    let url;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch {
        res.writeHead(400);
        res.end();
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SECURITY);
        res.end();
        return;
    }
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400, SECURITY);
        res.end();
        return;
    }

    if (pathname === '/api/status') {
        // forma de siempre (la usa el cliente), para la sala elegida con ?sala=
        const s = buscarSala(url.searchParams.get('sala'));
        const d = datosSala(s);
        return sendJson(res, {
            hostname: s.nombre,
            map: d.mapa,
            maxPlayers: s.maxJugadores,
            webPlayers: d.web,
            needsPassword: Boolean(cfg.password),
            serverOnline: d.online,
            assets: assetsParaCliente(),
            sala: s.id,
            salas: salas.length,
        });
    }

    if (pathname === '/api/salas') {
        return sendJson(res, {
            nombre: cfg.hostname,
            archivos: cfg.archivos,
            needsPassword: Boolean(cfg.password),
            salas: salas.map(datosSala),
        });
    }

    if (pathname === '/game/valve.zip') {
        if (cfg.archivos === 'propios') {
            return sendText(res, 404, 'Este servidor es público: usá tus propios archivos del juego.');
        }
        const ip = ipDe(req);
        if (demasiadosFallos(ip)) return sendText(res, 429, 'Demasiados intentos con la contraseña: probá de nuevo en unos minutos.');
        if (!claveOk(url.searchParams.get('clave'))) {
            anotarFallo(ip);
            return sendText(res, 403, 'Falta la contraseña del servidor.');
        }
        // El navegador lo guarda en IndexedDB según la versión: no hace falta caché HTTP.
        return sendFile(req, res, path.join(cfg.data, 'valve.zip'), 'no-store', leerAssets()?.version);
    }

    if (pathname === '/game/mod.zip') {
        return sendFile(req, res, path.join(cfg.data, 'mod.zip'), 'no-store', leerMod()?.version);
    }

    if (pathname === '/' || pathname === '/index.html') return sendIndex(req, res);
    if (pathname.startsWith('/cliente/')) return servirDe(CLIENTE, pathname.slice('/cliente/'.length), req, res);
    if (pathname.startsWith('/marca/')) return servirDe(MARCA, pathname.slice('/marca/'.length), req, res);

    const rel = pathname.replace(/^\/+/, '');
    // Los archivos de assets/ llevan hash en el nombre: se pueden guardar para siempre.
    const immutable = rel.startsWith('assets/');
    return servirDe(PUBLIC, rel, req, res, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

// --------------------------------------------------------------- WebRTC
cfg.maxPeers = salas.reduce((n, s) => n + s.maxJugadores + 2, 0) + 4;
const bridge = new RtcBridge(cfg);
bridge.on('join', (p) => log(`[web] jugador conectado a la sala ${p.sala} (${bridge.count} en línea)`));
bridge.on('leave', (p, why) => log(`[web] jugador desconectado de la sala ${p.sala}: ${why} (${bridge.count} en línea)`));

function ipDe(req) {
    const directa = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!cfg.confiarProxy) return directa;
    const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return reenviada || directa;
}

const httpServer = http.createServer(handler);
httpServer.headersTimeout = 20000;
httpServer.requestTimeout = 0; // la descarga de valve.zip puede tardar
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
httpServer.on('upgrade', (req, socket, head) => {
    let url = null;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch { /* url rota */ }
    if (!url || url.pathname !== '/signal') {
        socket.destroy();
        return;
    }
    const sala = buscarSala(url.searchParams.get('sala'));
    wss.handleUpgrade(req, socket, head, (ws) => {
        cfg.maxPeers = salas.reduce((n, s) => n + s.maxJugadores + 2, 0) + 4;
        bridge.handle(ws, ipDe(req), sala);
    });
});

httpServer.listen(cfg.httpPort, '0.0.0.0', () => {
    log(`[web] página del juego en el puerto ${cfg.httpPort}; WebRTC en UDP ${cfg.webrtcPort}` +
        (cfg.publicIp ? ` anunciando ${cfg.publicIp}` : '') + `; archivos del juego: ${cfg.archivos}`);
    if (!assetsParaCliente()) log(`[web] aviso: todavía no hay ${cfg.archivos === 'propios' ? 'mod.zip' : 'valve.zip'} en ${cfg.data}`);
});

let shuttingDown = false;
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    bridge.closeAll();
    httpServer.close();
    setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
