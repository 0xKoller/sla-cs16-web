// Servidor web del juego: página (cliente Xash3D en WebAssembly), paquete de archivos
// (valve.zip con tus personajes), estado y señalización WebRTC.
//
// Basado en server/index.mjs y server/http.mjs de CSweb
// (https://github.com/santiagoPostacchini/CSweb, MIT).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RtcBridge } from './rtc.mjs';
import { consultarInfo } from './consulta.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] ?? '').trim() || d;

const cfg = {
    httpPort: Number(env('PUERTO_WEB', '27016')),
    webrtcPort: Number(env('PUERTO_WEBRTC', '27018')),
    gamePort: Number(env('PUERTO_JUEGO', '27015')),
    publicIp: env('IP_PUBLICA', ''),
    hostname: env('NOMBRE_SERVIDOR', 'CS 1.6 propio'),
    map: env('MAPA', 'de_dust2'),
    maxPlayers: Number(env('MAX_JUGADORES', '12')),
    password: env('CONTRASENA', ''),
    data: env('DATOS', '/data/build'),
    publicDir: env('PUBLICO', path.join(HERE, 'public')),
};
cfg.maxPeers = cfg.maxPlayers + 4;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.zip': 'application/zip',
    '.pk3': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8',
};
const SECURITY = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
};

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ------------------------------------------------------------------ estado
let assetsCache = { mtime: 0, value: null };
function readAssets() {
    const file = path.join(cfg.data, 'assets.json');
    try {
        const st = fs.statSync(file);
        if (st.mtimeMs !== assetsCache.mtime) {
            assetsCache = { mtime: st.mtimeMs, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
        }
    } catch {
        assetsCache = { mtime: 0, value: null };
    }
    return assetsCache.value;
}

const game = { online: false, map: cfg.map, players: 0, bots: 0 };
async function pollGame() {
    const info = await consultarInfo(cfg.gamePort);
    const wasOnline = game.online;
    if (info) {
        Object.assign(game, { online: true, map: info.map || game.map, players: info.players, bots: info.bots });
        if (!wasOnline) log(`[juego] servidor de CS listo, mapa ${game.map}`);
    } else {
        game.online = false;
        if (wasOnline) log('[juego] el servidor de CS no responde');
    }
}
setInterval(pollGame, 5000).unref();
pollGame();

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

const PUBLIC = path.resolve(cfg.publicDir);
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
        const body = JSON.stringify({
            hostname: cfg.hostname,
            map: game.map,
            maxPlayers: cfg.maxPlayers,
            webPlayers: bridge.count,
            needsPassword: Boolean(cfg.password),
            serverOnline: game.online,
            assets: readAssets(),
        });
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...SECURITY });
        res.end(body);
        return;
    }

    if (pathname === '/game/valve.zip') {
        // El navegador lo guarda en IndexedDB según la versión: no hace falta caché HTTP.
        sendFile(req, res, path.join(cfg.data, 'valve.zip'), 'no-store', readAssets()?.version);
        return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) {
        res.writeHead(403, SECURITY);
        res.end();
        return;
    }
    // Los archivos de assets/ llevan hash en el nombre: se pueden guardar para siempre.
    const immutable = rel.startsWith('assets/');
    sendFile(req, res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

// --------------------------------------------------------------- WebRTC
const bridge = new RtcBridge(cfg);
bridge.on('join', (p) => log(`[web] jugador conectado (${bridge.count} en línea)`));
bridge.on('leave', (p, why) => log(`[web] jugador desconectado: ${why} (${bridge.count} en línea)`));

const httpServer = http.createServer(handler);
httpServer.headersTimeout = 20000;
httpServer.requestTimeout = 0; // la descarga de valve.zip puede tardar
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
        pathname = new URL(req.url, 'http://localhost').pathname;
    } catch { /* url rota */ }
    if (pathname !== '/signal') {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        bridge.handle(ws, remote);
    });
});

httpServer.listen(cfg.httpPort, '0.0.0.0', () => {
    log(`[web] página del juego en el puerto ${cfg.httpPort}; WebRTC en UDP ${cfg.webrtcPort}` +
        (cfg.publicIp ? ` anunciando ${cfg.publicIp}` : ''));
    if (!readAssets()) log('[web] aviso: todavía no hay valve.zip/assets.json en ' + cfg.data);
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
