// Botones grandes para jugar desde el celular: «Comprar», «Compra rápida» y «Equipo».
//
// En CS 1.6 los menús (compra, equipo) se eligen con números. Con controles táctiles, al
// abrir un menú el juego dibuja una fila de números abajo de todo: no hay «OK», tocar el
// número ya elige (o compra) y el 0 cierra. Estos botones solo abren el menú o compran
// directo, y avisan cómo se usa la primera vez.

// Compra rápida: rifle (el de tu equipo; el otro el servidor lo rechaza), chaleco con
// casco, pistola, balas, granadas y, si sos antiterrorista, el kit para desactivar.
export const COMPRA_RAPIDA = ['m4a1', 'ak47', 'vesthelm', 'deagle', 'primammo', 'secammo', 'hegren', 'flash', 'defuser'];

const AVISO_COMPRA = 'Tocá el número de lo que querés en la fila de abajo: no hay «OK», se compra al tocarlo. El 0 cierra.';

let barra = null;
let cartel = null;
let temporizador = 0;

function leer(k) {
    try { return Number(localStorage.getItem(k) || 0); } catch { return 0; }
}
function guardar(k, v) {
    try { localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ }
}

export function ejecutar(comandos, motor = globalThis.xash) {
    if (!motor?.Cmd_ExecuteString) return false;
    for (const c of comandos) motor.Cmd_ExecuteString(c);
    return true;
}

function avisar(texto, ms = 4500) {
    if (!cartel) return;
    cartel.textContent = texto;
    cartel.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { cartel.hidden = true; }, ms);
}

const ACCIONES = {
    comprar() {
        ejecutar(['buy']);
        // el aviso solo las primeras veces
        const veces = leer('cs16:aviso-compra');
        if (veces < 3) {
            avisar(AVISO_COMPRA, 6000);
            guardar('cs16:aviso-compra', veces + 1);
        }
    },
    rapida() {
        ejecutar(COMPRA_RAPIDA);
        avisar('Compra rápida: rifle, chaleco, pistola y granadas (si estás en la zona y el tiempo de compra).');
    },
    equipo() {
        ejecutar(['chooseteam']);
        avisar('Tocá el número del equipo en la fila de abajo (1 terroristas, 2 antiterroristas, 5 automático).');
    },
};

function crear() {
    barra = document.createElement('div');
    barra.className = 'cs16-tactil';
    barra.innerHTML = `
        <button type="button" data-accion="comprar">Comprar</button>
        <button type="button" data-accion="rapida">Compra rápida</button>
        <button type="button" data-accion="equipo">Equipo</button>`;
    cartel = document.createElement('p');
    cartel.className = 'cs16-tactil-aviso';
    cartel.hidden = true;
    cartel.setAttribute('role', 'status');

    // Que los toques en estos botones no le lleguen al juego (si no, mueven la mira)
    for (const tipo of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
        barra.addEventListener(tipo, (e) => e.stopPropagation(), { passive: true });
    }
    barra.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const accion = e.target.closest('button')?.dataset.accion;
        if (accion && ACCIONES[accion]) ACCIONES[accion]();
    });
    document.body.append(barra, cartel);
}

// Se llama al entrar a jugar con los controles táctiles prendidos
export function activar() {
    if (!barra) crear();
    document.body.classList.add('cs16-tactil-on');
}
