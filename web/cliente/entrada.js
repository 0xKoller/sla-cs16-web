// Funciones propias de la pantalla de entrada y del juego:
//   - salas: si el servidor tiene varias, una lista para elegir a cuál entrar
//   - equipo: elegirlo antes de entrar y aparecer jugando (sin pasar por el observador)
//   - archivos propios: en servidores públicos, elegir la carpeta de CS 1.6 de Steam
//   - manos: apuntar y disparar con la mano (cámara); ⌥/Alt + H cambia mano ↔ mouse
// La página la carga sola (web/servidor.mjs la agrega al final de index.html).

import * as archivos from './archivos.js';
import { entrarAlEquipo } from './equipo.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const jugar = $('play');
const lobby = $('lobby');
const params = new URLSearchParams(location.search);
const leer = (k, d = null) => {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const guardar = (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
};
const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// La función del cliente que carga los archivos pasa por acá (ver archivos.js)
archivos.instalarEnganche(() => window.cs16Estado, () => $('password')?.value || '');

function insertarAntesDeJugar(...nodos) {
    for (const n of nodos) form.insertBefore(n, jugar);
}

// ---------------------------------------------------------------- salas
let salas = [];
let modoArchivos = 'servidor';

function elegirSala(id) {
    window.cs16Sala = id;
    guardar('cs16:sala', id);
    for (const b of document.querySelectorAll('.cs16-sala')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
    const s = salas.find((x) => x.id === id);
    if (s) {
        $('server-name').textContent = s.nombre;
        $('server-map').textContent = s.mapa;
        $('server-players').textContent = `${s.web} / ${s.max}`;
    }
}

function pintarSalas(caja) {
    caja.hidden = salas.length < 2;
    if (caja.hidden) return;
    caja.innerHTML = '<p class="cs16-titulo">Elegí una sala</p>' + salas.map((s) => `
        <button type="button" class="cs16-sala" data-id="${escapar(s.id)}" aria-pressed="${s.id === window.cs16Sala}"
                ${s.online ? '' : 'data-apagada="1"'}>
          <i class="cs16-punto${s.online ? ' on' : ''}"></i>
          <span class="cs16-sala-nombre">${escapar(s.nombre)}</span>
          <span class="cs16-sala-datos">${escapar(s.mapa)} · ${s.jugadores}${s.bots ? ` + ${s.bots} bots` : ''} / ${s.max}</span>
        </button>`).join('');
}

async function actualizarSalas(caja) {
    try {
        const r = await fetch('/api/salas', { cache: 'no-store' });
        if (!r.ok) return;
        const datos = await r.json();
        salas = datos.salas || [];
        modoArchivos = datos.archivos || 'servidor';
        if (!salas.some((s) => s.id === window.cs16Sala)) {
            const guardada = leer('cs16:sala');
            const inicial = params.get('sala') || guardada;
            window.cs16Sala = (salas.find((s) => s.id === inicial) || salas.find((s) => s.online) || salas[0])?.id;
        }
        pintarSalas(caja);
        mostrarArchivos();
    } catch { /* el servidor web no responde: lo dice el puntito de estado */ }
}

// ---------------------------------------------------------------- equipo
const EQUIPOS = [['5', 'Automático'], ['1', 'Terroristas'], ['2', 'Antiterroristas']];

function crearEquipo() {
    const caja = document.createElement('div');
    caja.className = 'cs16-equipo';
    const actual = params.get('equipo') || leer('cs16:equipo', '5');
    caja.innerHTML = '<span class="cs16-equipo-titulo" id="cs16-equipo-titulo">Equipo</span>' +
        '<div class="cs16-equipo-opciones" role="radiogroup" aria-labelledby="cs16-equipo-titulo">' +
        EQUIPOS.map(([v, t]) => `
        <label><input type="radio" name="cs16-equipo" value="${v}" ${v === actual ? 'checked' : ''}><span>${t}</span></label>`).join('') +
        '</div>';
    caja.addEventListener('change', () => guardar('cs16:equipo', equipoElegido()));
    return caja;
}

function equipoElegido() {
    return document.querySelector('input[name=cs16-equipo]:checked')?.value || '5';
}

// --------------------------------------------------------- archivos propios
let cajaArchivos = null;

function crearArchivos() {
    const caja = document.createElement('section');
    caja.className = 'cs16-archivos';
    caja.hidden = true;
    caja.innerHTML = `
      <p class="cs16-titulo">Tus archivos de Counter-Strike 1.6</p>
      <p class="cs16-nota">Este servidor es público: cada jugador usa sus propios archivos del juego (los de Steam).
        Se leen en tu navegador y quedan guardados ahí; <b>no se suben a ningún lado</b>.</p>
      <div class="cs16-archivos-fila">
        <span class="cs16-archivos-estado">Todavía no elegiste la carpeta</span>
        <label class="cs16-boton">Elegir carpeta «Half-Life»<input type="file" webkitdirectory directory multiple hidden></label>
      </div>
      <details class="cs16-donde"><summary>¿Dónde está esa carpeta?</summary>
        <ul>
          <li><b>Windows:</b> C:\\Program Files (x86)\\Steam\\steamapps\\common\\Half-Life</li>
          <li><b>Mac:</b> ~/Library/Application Support/Steam/steamapps/common/Half-Life
            (en la ventana para elegir, apretá <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>G</kbd> y pegá la ruta)</li>
          <li><b>Linux:</b> ~/.steam/steam/steamapps/common/Half-Life</li>
        </ul>
        Necesitás tener Counter-Strike en Steam. El navegador va a avisar que «subís» archivos:
        en realidad solo se leen acá.</details>`;
    const input = caja.querySelector('input');
    input.addEventListener('change', async () => {
        if (!input.files?.length) return;
        const estado = caja.querySelector('.cs16-archivos-estado');
        bloquearJugar('Guardando tus archivos…');
        try {
            const meta = await archivos.guardar(input.files, (hechos, total) => {
                estado.textContent = `Guardando… ${hechos} de ${total}`;
            });
            pintarEstadoArchivos(meta);
        } catch (e) {
            estado.textContent = e.message;
            estado.dataset.error = '1';
            bloquearJugar('Elegí tus archivos primero');
        }
        input.value = '';
    });
    return caja;
}

function bloquearJugar(texto) {
    jugar.dataset.bloqueado = 'archivos';
    jugar.disabled = true;
    jugar.textContent = texto;
}

function desbloquearJugar() {
    if (jugar.dataset.bloqueado !== 'archivos') return;
    delete jugar.dataset.bloqueado;
    jugar.disabled = false;
    jugar.textContent = 'Jugar';
}

function pintarEstadoArchivos(meta) {
    const estado = cajaArchivos.querySelector('.cs16-archivos-estado');
    delete estado.dataset.error;
    if (meta) {
        estado.textContent = `Listos: ${meta.archivos.toLocaleString('es')} archivos (${Math.round(meta.bytes / 1048576)} MB) ✓`;
        cajaArchivos.querySelector('.cs16-boton').firstChild.textContent = 'Cambiar carpeta';
        desbloquearJugar();
    } else {
        estado.textContent = 'Todavía no elegiste la carpeta';
        bloquearJugar('Elegí tus archivos primero');
    }
}

async function mostrarArchivos() {
    if (!cajaArchivos) return;
    const propios = modoArchivos === 'propios';
    document.body.classList.toggle('cs16-propios', propios);
    if (cajaArchivos.hidden === !propios) return;
    cajaArchivos.hidden = !propios;
    if (propios) pintarEstadoArchivos(await archivos.estado());
    else desbloquearJugar();
}

// ------------------------------------------------------------------ manos
function crearManos() {
    const fila = document.createElement('label');
    fila.className = 'check cs16-manos';
    fila.innerHTML = '<input id="manos" type="checkbox"> <span>Apuntar con la mano <small>(usa la cámara)</small></span>';
    const ayuda = document.createElement('p');
    ayuda.className = 'cs16-nota cs16-manos-ayuda';
    ayuda.innerHTML = 'Hacé una pistolita con la mano frente a la cámara: el <b>índice</b> apunta, ' +
        '<b>bajá el pulgar</b> para disparar y <b>abrí la mano</b> para recargar. Moverte sigue siendo con WASD. ' +
        'Con <kbd>⌥</kbd>+<kbd>H</kbd> (Alt+H) cambiás entre la mano y el mouse cuando quieras. ' +
        'La imagen de la cámara no sale de tu compu.';
    const casilla = fila.querySelector('input');
    const param = params.get('manos');
    casilla.checked = param !== null ? param !== '0' : leer('cs16:manos-activo') === '1';
    const mostrar = () => { ayuda.hidden = !casilla.checked; };
    mostrar();
    casilla.addEventListener('change', () => {
        mostrar();
        guardar('cs16:manos-activo', casilla.checked ? '1' : '0');
    });
    return { fila, ayuda, casilla, demo: param === 'demo' };
}

const cargarManos = () => import('./manos/manos.js');

// ⌥/Alt + H en cualquier momento del juego: prende el control con la mano o cambia mano ↔ mouse
window.addEventListener('keydown', (e) => {
    if (!(e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH')) return;
    if (!document.body.classList.contains('playing')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    cargarManos().then((m) => m.alternar({ demo: params.get('manos') === 'demo' }))
        .catch((err) => console.error('[manos]', err));
}, true);

// ------------------------------------------------------------- dos columnas
// En pantallas anchas la entrada va en dos columnas (marca, sala y controles a la
// izquierda; nombre, equipo y «Jugar» a la derecha) para que entre sin scrollear.
// En el celular queda una sola columna, como siempre. El diseño está en entrada.css.
function armarColumnas() {
    if (lobby.querySelector(':scope > .cs16-col')) return;
    const columna = (clase, selectores) => {
        const div = document.createElement('div');
        div.className = `cs16-col ${clase}`;
        for (const sel of selectores) {
            const n = lobby.querySelector(`:scope > ${sel}`);
            if (n) div.append(n);
        }
        return div;
    };
    const izq = columna('cs16-col-izq', ['header', '.cs16-salas', '.server', 'details.help']);
    const der = columna('cs16-col-der', ['#form', '#lock-hint', '#error', '#download-hint']);
    lobby.prepend(izq, der);
    lobby.classList.add('cs16-ancho');
    const ayuda = izq.querySelector('details.help');
    if (ayuda && matchMedia('(min-width: 860px)').matches) ayuda.open = true;
    // la consola es la tecla de al lado del 1 (en teclados en español, «º»)
    for (const k of ayuda?.querySelectorAll('kbd') || []) if (k.textContent === '`') k.textContent = 'º';
}

// ----------------------------------------------------------------- arranque
if (form && jugar && lobby && !document.querySelector('.cs16-equipo')) {
    const cajaSalas = document.createElement('section');
    cajaSalas.className = 'cs16-salas';
    cajaSalas.hidden = true;
    cajaSalas.addEventListener('click', (e) => {
        const b = e.target.closest('.cs16-sala');
        if (b) elegirSala(b.dataset.id);
    });
    lobby.querySelector('.server')?.before(cajaSalas);

    const equipo = crearEquipo();
    cajaArchivos = crearArchivos();
    const manos = crearManos();
    insertarAntesDeJugar(equipo, manos.fila, manos.ayuda, cajaArchivos);
    armarColumnas();

    actualizarSalas(cajaSalas);
    setInterval(() => { if (!lobby.hidden) actualizarSalas(cajaSalas); }, 5000);

    form.addEventListener('submit', () => {
        if (jugar.dataset.bloqueado) return;
        entrarAlEquipo(equipoElegido()).catch((e) => console.warn('[equipo]', e));
        if (manos.casilla.checked) {
            cargarManos().then((m) => m.iniciar({ demo: manos.demo }))
                .catch((e) => console.error('[manos] no pude arrancar el control con la mano', e));
        }
    });
}
