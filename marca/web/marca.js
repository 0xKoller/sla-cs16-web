// Marca SLA para la página del juego: logo, título y textos.
// La agrega web/servidor.mjs al final de la página; los cambios se ven al recargar.

const TITULO = 'SLA · Counter-Strike 1.6';
const BAJADA = 'Siguiendo los acontecimientos';

document.title = TITULO;
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
