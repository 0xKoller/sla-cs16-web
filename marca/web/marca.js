// Marca SLA para la página del juego: logo, título y textos.
// La agrega web/servidor.mjs al final de la página; los cambios se ven al recargar.

const TITULO = 'SLA · Counter-Strike 1.6';
const BAJADA = 'Siguiendo los acontecimientos';

document.title = TITULO;
// El motor del juego cambia el título de la pestaña al arrancar: lo volvemos a poner.
new MutationObserver(() => {
    if (document.title !== TITULO) document.title = TITULO;
}).observe(document.head, { subtree: true, childList: true, characterData: true });
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#181818');

function logo(clase) {
    const img = document.createElement('img');
    img.className = clase;
    img.src = '/marca/sla-logo.svg';
    img.alt = 'SLA';
    img.width = 2469;
    img.height = 742;
    return img;
}

const header = document.querySelector('#lobby header');
if (header) {
    const h1 = document.createElement('h1');
    h1.textContent = 'Counter-Strike 1.6';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = BAJADA;
    const textos = document.createElement('div');
    textos.append(h1, sub);
    header.replaceChildren(logo('marca-logo'), textos);
}

const lobby = document.getElementById('lobby');
if (lobby && !lobby.querySelector('.marca-pie')) {
    const pie = document.createElement('p');
    pie.className = 'marca-pie';
    const enlace = document.createElement('a');
    enlace.href = 'https://slatv.live';
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    enlace.textContent = 'slatv.live';
    const marca = document.createElement('span');
    marca.textContent = 'SLA';
    pie.append(marca, enlace);
    lobby.append(pie);
}

const cargando = document.getElementById('loading');
if (cargando && !cargando.querySelector('.marca-logo')) {
    cargando.prepend(logo('marca-logo marca-logo-chico'));
}

// ---------------------------------------------------------------- manos
// Opción «Apuntar con la mano»: usa la cámara para apuntar y disparar (manos/manos.js).
// Con ?manos en la dirección viene tildada; con ?manos=demo prueba sin cámara.
const form = document.getElementById('form');
const jugar = document.getElementById('play');
if (form && jugar && !document.getElementById('manos')) {
    const param = new URLSearchParams(location.search).get('manos');
    let guardado = null;
    try { guardado = localStorage.getItem('cs16:manos-activo'); } catch { /* sin almacenamiento */ }

    const fila = document.createElement('label');
    fila.className = 'check marca-manos';
    fila.innerHTML = '<input id="manos" type="checkbox"> <span>Apuntar con la mano <small>(usa la cámara)</small></span>';
    const ayuda = document.createElement('p');
    ayuda.className = 'marca-manos-ayuda';
    ayuda.innerHTML = 'Hacé una pistolita con la mano frente a la cámara: el <b>índice</b> apunta, ' +
        '<b>bajá el pulgar</b> para disparar y <b>abrí la mano</b> para recargar. Moverte sigue siendo con WASD. ' +
        'La imagen de la cámara no sale de tu compu.';
    form.insertBefore(fila, jugar);
    form.insertBefore(ayuda, jugar);

    const casilla = fila.querySelector('input');
    casilla.checked = param !== null ? param !== '0' : guardado === '1';
    const mostrarAyuda = () => { ayuda.hidden = !casilla.checked; };
    mostrarAyuda();
    casilla.addEventListener('change', () => {
        mostrarAyuda();
        try { localStorage.setItem('cs16:manos-activo', casilla.checked ? '1' : '0'); } catch { /* idem */ }
    });

    // «Jugar» solo se habilita con el servidor listo; al tocarlo arranca también la cámara.
    form.addEventListener('submit', () => {
        if (!casilla.checked) return;
        import('/marca/manos/manos.js')
            .then((m) => m.iniciar({ demo: param === 'demo' }))
            .catch((e) => console.error('[manos] no pude arrancar el control con la mano', e));
    });
}
