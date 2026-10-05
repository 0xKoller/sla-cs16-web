// Jugar desde el celular.
//
// En CS 1.6 los menús (compra, equipo) se eligen con números, pero en el celular el juego
// no muestra ningún botón para elegirlos: el menú aparecía y no había forma de «confirmar».
// Acá:
//   - «Comprar» y «Equipo» abren el menú y muestran un teclado de números grande. No hay
//     «OK»: tocar el número ya elige (o compra); el 0 cierra.
//   - «Compra rápida»: rifle, chaleco, pistola y granadas de un toque.
//   - Se sacan del juego los botones que llevaban a pantallas que no sirven acá: el
//     engranaje (editor de controles, «la pantalla de configuración»), los menús de bots,
//     comandos y radio, el chat (pide teclado) y los de compra/equipo del juego
//     (reemplazados por estos).
//   - Con el celular vertical, un cartel pide girarlo.

// Compra rápida: rifle (el de tu equipo; el otro el servidor lo rechaza), chaleco con
// casco, pistola, balas, granadas y, si sos antiterrorista, el kit para desactivar.
export const COMPRA_RAPIDA = ['m4a1', 'ak47', 'vesthelm', 'deagle', 'primammo', 'secammo', 'hegren', 'flash', 'defuser'];

// Botones del juego (cs16-client) que se sacan con controles táctiles
// (el chat y la radio también: piden teclado o números y en el celular quedaban colgados)
export const BOTONES_FUERA = ['touch_edit', 'bots', 'cmd', 'buy', 'change_team', 'radio', 'chat', 'say', 'say2'];

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

let barra = null;
let teclado = null;
let cartel = null;
let girar = null;
let temporizador = 0;
let cierre = 0;
let toques = 0;

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

// ------------------------------------------------------------ teclado de números
// Los menús de CS tienen dos pasos (categoría y arma, o equipo y personaje): después del
// segundo toque, o del 0, el teclado se esconde solo.
function abrirTeclado(titulo) {
    toques = 0;
    teclado.querySelector('.cs16-teclado-titulo').textContent = titulo;
    teclado.hidden = false;
    programarCierre();
}
function cerrarTeclado() {
    teclado.hidden = true;
    clearTimeout(cierre);
}
function programarCierre() {
    clearTimeout(cierre);
    cierre = setTimeout(cerrarTeclado, 20000);
}
export function tocarNumero(n, motor = globalThis.xash) {
    ejecutar([`slot${n === '0' ? 10 : n}`], motor);   // así elige el juego en sus menús
    toques++;
    if (n === '0' || toques >= 2) cerrarTeclado();
    else programarCierre();
}

const ACCIONES = {
    comprar() {
        ejecutar(['buy']);
        abrirTeclado('Elegí con el número: no hay «OK», se compra al tocarlo. 0 cierra.');
    },
    rapida() {
        ejecutar(COMPRA_RAPIDA);
        avisar('Compra rápida: rifle, chaleco, pistola y granadas (si estás en la zona y el tiempo de compra).');
    },
    equipo() {
        ejecutar(['chooseteam']);
        abrirTeclado('1 terroristas · 2 antiterroristas · 5 automático. Después, el personaje (5 = cualquiera).');
    },
};

// que los toques en estos elementos no le lleguen al juego (si no, mueven la mira)
function aislar(el) {
    for (const tipo of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
        el.addEventListener(tipo, (e) => e.stopPropagation(), { passive: true });
    }
}

function crear() {
    barra = document.createElement('div');
    barra.className = 'cs16-tactil';
    barra.innerHTML = `
        <button type="button" data-accion="comprar">Comprar</button>
        <button type="button" data-accion="rapida">Compra rápida</button>
        <button type="button" data-accion="equipo">Equipo</button>`;
    barra.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const accion = e.target.closest('button')?.dataset.accion;
        if (accion && ACCIONES[accion]) ACCIONES[accion]();
    });

    teclado = document.createElement('div');
    teclado.className = 'cs16-teclado';
    teclado.hidden = true;
    teclado.innerHTML = '<p class="cs16-teclado-titulo"></p><div class="cs16-teclado-numeros">' +
        TECLAS.map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('') +
        '</div><button type="button" class="cs16-teclado-cerrar" aria-label="Cerrar">✕</button>';
    teclado.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('cs16-teclado-cerrar')) {
            ejecutar(['slot10']);
            cerrarTeclado();
        } else tocarNumero(b.dataset.n);
    });

    cartel = document.createElement('p');
    cartel.className = 'cs16-tactil-aviso';
    cartel.hidden = true;
    cartel.setAttribute('role', 'status');

    girar = document.createElement('div');
    girar.className = 'cs16-girar';
    girar.innerHTML = '<p>Girá el celular para jugar</p>';

    for (const el of [barra, teclado, girar]) aislar(el);
    document.body.append(barra, teclado, cartel, girar);
}

function sacarBotonesDelJuego() {
    ejecutar(BOTONES_FUERA.map((b) => `touch_removebutton ${b}`));
}

// Se llama al entrar a jugar con los controles táctiles prendidos
export function activar() {
    if (!barra) crear();
    document.body.classList.add('cs16-tactil-on');
    // el juego carga sus botones al arrancar: se sacan varias veces por las dudas
    for (const ms of [4000, 10000, 25000, 60000]) setTimeout(sacarBotonesDelJuego, ms);
    const veces = leer('cs16:aviso-tactil');
    if (veces < 3) {
        setTimeout(() => avisar('Para comprar tocá «Comprar» y elegí con los números (no hay «OK»). «Equipo» cambia de equipo.', 8000), 9000);
        guardar('cs16:aviso-tactil', veces + 1);
    }
}
