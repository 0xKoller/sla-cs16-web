// Consultas UDP al servidor dedicado (que escucha sólo en 127.0.0.1).
//   consultarInfo()  -> mapa, jugadores (A2S_INFO)
//   rcon(cmd)        -> manda un comando de consola y devuelve la respuesta
import dgram from 'node:dgram';

const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function readString(buf, off) {
    const end = buf.indexOf(0, off);
    if (end < 0) return [buf.subarray(off).toString('utf8'), buf.length];
    return [buf.subarray(off, end).toString('utf8'), end + 1];
}

export function parseInfo(msg) {
    if (msg.length < 6 || msg.readInt32LE(0) !== -1) return null;
    const type = msg[4];
    let off = 5;
    const str = () => {
        const [s, next] = readString(msg, off);
        off = next;
        return s;
    };
    if (type === 0x49) { // 'I' (formato Source, también lo usa GoldSrc nuevo)
        off += 1; // protocolo
        const name = str();
        const map = str();
        str(); // carpeta
        str(); // juego
        off += 2; // appid
        const players = msg[off] ?? 0;
        const maxPlayers = msg[off + 1] ?? 0;
        const bots = msg[off + 2] ?? 0;
        return { name, map, players, maxPlayers, bots };
    }
    if (type === 0x6d) { // 'm' (formato GoldSrc viejo)
        str(); // dirección
        const name = str();
        const map = str();
        str();
        str();
        const players = msg[off] ?? 0;
        const maxPlayers = msg[off + 1] ?? 0;
        return { name, map, players, maxPlayers, bots: 0 };
    }
    return null;
}

export function consultarInfo(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket('udp4');
        const query = Buffer.concat([OOB, Buffer.from('TSource Engine Query\0', 'latin1')]);
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { sock.close(); } catch { /* cerrado */ }
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        sock.on('error', () => finish(null));
        sock.on('message', (msg) => {
            if (msg.length >= 9 && msg.readInt32LE(0) === -1 && msg[4] === 0x41) {
                // el servidor pide un "challenge": se repite la consulta con ese número
                sock.send(Buffer.concat([query, msg.subarray(5, 9)]), port, '127.0.0.1');
                return;
            }
            const info = parseInfo(msg);
            if (info) finish(info);
        });
        sock.bind(0, '127.0.0.1', () => sock.send(query, port, '127.0.0.1'));
    });
}

export function rcon(port, password, cmd, waitMs = 600) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket('udp4');
        const parts = [];
        sock.on('message', (msg) => {
            if (msg.length > 4 && msg.readInt32LE(0) === -1) {
                parts.push(msg.subarray(4).toString('utf8').replace(/^(print|l)\n?/, ''));
            }
        });
        sock.on('error', () => undefined);
        sock.bind(0, '127.0.0.1', () => {
            const payload = Buffer.concat([OOB, Buffer.from(`rcon ${password} ${cmd}\n`, 'utf8')]);
            sock.send(payload, port, '127.0.0.1');
        });
        setTimeout(() => {
            try { sock.close(); } catch { /* cerrado */ }
            resolve(parts.join(''));
        }, waitMs);
    });
}
