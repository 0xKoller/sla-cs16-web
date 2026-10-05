// Cuida la partida mientras jugás:
//   - Si se corta la conexión con la sala (te desconectaste desde el menú del CS, te
//     echaron, la sala se reinició, la contraseña no es la correcta o el juego se cerró),
//     en vez de dejarte en el menú del CS (que acá no sirve) muestra un cartel con
//     «Volver a entrar».
//   - Al cerrar o recargar la página avisa a la sala que te vas: si no, tu jugador quedaba
//     «fantasma» un rato y al volver entrabas como «Nombre (1)».

const SIN_DATOS_MS = 15000;     // sin paquetes de la sala durante este tiempo = cortado (un cambio de mapa tarda menos)
const GRACIA_MS = 25000;        // tras un corte de red el cliente reintenta solo

// Mensajes de la consola del motor que explican el corte
export const MOTIVOS = [
    [/reject the connection.*(password|BADPASSWORD)|BADPASSWORD|invalid password/i, 'clave',
        'Contraseña incorrecta', 'La sala no aceptó la contraseña. Volvé al inicio y escribila de nuevo.'],
    [/You were kicked|You are banned|banned list/i, 'echado',   // («X was kicked» es otro, por ejemplo un bot)
        'Te sacaron de la sala', 'Un administrador te sacó de la partida.'],
    [/reject the connection|Connection rejected/i, 'rechazo',
        'La sala no te dejó entrar', 'Puede estar llena. Probá de nuevo en un rato o elegí otra sala.'],
    [/Server shutdown|Server issued disconnect/i, 'sala',
        'La sala se reinició', 'Volvé a entrar en unos segundos.'],
];

export function motivoDe(linea) {
    for (const [re, id, titulo, texto] of MOTIVOS) if (re.test(linea)) return { id, titulo, texto };
    return null;
}

let cartel = null;
let mostrado = false;

function mostrar(titulo, texto) {
    if (mostrado) return;
    mostrado = true;
    if (!cartel) {
        cartel = document.createElement('div');
        cartel.className = 'cs16-corte';
        cartel.setAttribute('role', 'alertdialog');
        cartel.innerHTML = '<div class="cs16-corte-caja"><h2></h2><p></p>' +
            '<button type="button">Volver a entrar</button></div>';
        cartel.querySelector('button').addEventListener('click', () => location.reload());
        for (const tipo of ['touchstart', 'pointerdown', 'mousedown', 'keydown']) {
            cartel.addEventListener(tipo, (e) => e.stopPropagation());
        }
        document.body.append(cartel);
    }
    cartel.querySelector('h2').textContent = titulo;
    cartel.querySelector('p').textContent = texto;
    cartel.hidden = false;
    try { document.exitPointerLock?.(); } catch { /* nada */ }
}

export function vigilar() {
    let ultimo = 0;             // último paquete recibido de la sala
    let graciaHasta = 0;
    let motor = null;

    // 1) motivos que el motor escribe en la consola
    const original = console.log;
    console.log = function (...args) {
        try {
            const m = motivoDe(String(args[0] ?? ''));
            if (m) setTimeout(() => mostrar(m.titulo, m.texto), 600);
        } catch { /* nada */ }
        return original.apply(this, args);
    };

    // 2) paquetes que llegan de la sala
    const engancharMotor = () => {
        const x = globalThis.xash;
        if (!x || x === motor || typeof x.receive !== 'function') return;
        motor = x;
        const recibir = x.receive.bind(x);
        x.receive = (datos) => {
            ultimo = Date.now();
            return recibir(datos);
        };
        // los cortes de red los reintenta el propio cliente: darle tiempo
        const estado = x.onTransportState;
        x.onTransportState = (s) => {
            if (s === 'lost') graciaHasta = Date.now() + GRACIA_MS;
            if (s === 'connected') graciaHasta = Date.now() + SIN_DATOS_MS;
            return estado?.(s);
        };
    };

    // al volver a la pestaña (celular que cambió de app) también hay que esperar
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) graciaHasta = Date.now() + GRACIA_MS;
    });

    setInterval(() => {
        engancharMotor();
        if (!document.body.classList.contains('playing') || document.hidden || mostrado) return;
        if (!ultimo || Date.now() < graciaHasta) return;
        if (Date.now() - ultimo > SIN_DATOS_MS) {
            mostrar('Se cortó la conexión con la sala',
                'Puede ser tu internet, que saliste de la partida desde el menú o que la sala se reinició.');
        }
    }, 1000);

    // 3) al irte, avisarle a la sala (si no, tu jugador queda «fantasma» un rato)
    window.addEventListener('pagehide', () => {
        try { if (globalThis.xash?.running) globalThis.xash.Cmd_ExecuteString('disconnect'); } catch { /* nada */ }
    });
}
