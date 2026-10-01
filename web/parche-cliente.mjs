// Ajustes sobre el cliente web ya compilado (public/assets/index-*.js, de CSweb).
// Se aplica al armar la imagen de Docker (ver Dockerfile). Cada cambio tiene que
// encontrar su texto exactamente una vez; si no, la imagen no se arma (mejor fallar
// que servir un cliente a medio cambiar).
//
//  1. Controles táctiles: en una compu sin pantalla táctil no se ofrecen y quedan
//     apagados siempre (antes Safari los prendía solos). Se repite touch_enable 0
//     unos segundos después de entrar por si el motor lo vuelve a prender.
//  2. Consola: la tecla de arriba a la izquierda (al lado del 1) y la de al lado del
//     Shift izquierdo abren/cierran la consola con cualquier distribución de teclado
//     (en teclados en español el motor no la reconocía).
//  3. «Jugar» queda deshabilitado mientras el servidor de CS no está prendido.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve(process.argv[2] || 'public');
const MARCA = '/*cs16-parche-1*/';

const CAMBIOS = [
  {
    nombre: 'táctil por defecto',
    viejo: 'function defaultTouch(){const e=localStorage.getItem("csweb:touch");return e===null?!matchMedia("(hover: hover)").matches:e==="true"}',
    nuevo: 'function hayTactil(){return navigator.maxTouchPoints>0}' +
      'function defaultTouch(){if(!hayTactil())return!1;const e=localStorage.getItem("cs16:touch");' +
      'return e===null?!matchMedia("(any-pointer: fine)").matches:e==="true"}',
  },
  {
    nombre: 'guardar elección táctil',
    viejo: 'localStorage.setItem("csweb:touch",String(touchInput.checked))',
    nuevo: 'localStorage.setItem("cs16:touch",String(touchInput.checked))',
  },
  {
    nombre: 'ocultar casilla táctil sin pantalla táctil',
    viejo: 'touchInput.checked=defaultTouch();',
    nuevo: 'touchInput.checked=defaultTouch();hayTactil()||(touchInput.checked=!1,touchInput.closest("label").style.display="none");',
  },
  {
    nombre: 'repetir touch_enable 0',
    viejo: 'e.Cmd_ExecuteString(`touch_enable ${t?1:0}`),',
    nuevo: 'e.Cmd_ExecuteString(`touch_enable ${t?1:0}`),' +
      't||[1e3,3e3,6e3,12e3,2e4].forEach(d=>setTimeout(()=>e.Cmd_ExecuteString("touch_enable 0"),d)),',
  },
  {
    nombre: 'tecla de consola',
    viejo: 'function guardShortcuts(e){',
    nuevo: 'window.addEventListener("keydown",r=>{if((r.code!=="Backquote"&&r.code!=="IntlBackslash")||r.ctrlKey||r.metaKey||r.altKey)return;' +
      'const x=window.xash;if(!x||!x.running)return;r.preventDefault(),r.stopImmediatePropagation(),' +
      'r.repeat||x.Cmd_ExecuteString("toggleconsole")},!0);' +
      'window.addEventListener("keyup",r=>{(r.code==="Backquote"||r.code==="IntlBackslash")&&window.xash?.running&&(r.preventDefault(),r.stopImmediatePropagation())},!0);' +
      'function guardShortcuts(e){',
  },
  {
    nombre: 'navegador sin soporte',
    viejo: 'Usá Chrome, Edge o Firefox actualizados."),playButton.disabled=!0);',
    nuevo: 'Usá Chrome, Edge o Firefox actualizados."),playButton.disabled=!0,playButton.dataset.bloqueado="1");',
  },
  {
    nombre: 'esperar al servidor',
    viejo: '$("server-online").classList.add("on")}catch{$("server-online").classList.remove("on")}}',
    nuevo: '$("server-online").classList.toggle("on",!!status.serverOnline),esperarServidor(!status.serverOnline)}' +
      'catch{$("server-online").classList.remove("on"),esperarServidor(!0)}}' +
      'function esperarServidor(e){failed||lobby.hidden||playButton.dataset.bloqueado||' +
      '(playButton.disabled=e,playButton.textContent=e?"Esperando al servidor…":"Jugar")}',
  },
];

// Cambios en index.html (textos de ayuda).
const CAMBIOS_HTML = [
  {
    nombre: 'ayuda: tecla de consola',
    viejo: '<kbd>`</kbd> consola',
    nuevo: '<kbd>º</kbd> consola (la tecla al lado del 1)',
  },
];

function contar(texto, buscado) {
  let n = 0;
  for (let i = texto.indexOf(buscado); i !== -1; i = texto.indexOf(buscado, i + buscado.length)) n++;
  return n;
}

const htmlPath = path.join(PUB, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const ref = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
if (!ref) throw new Error('index.html no referencia ningún assets/index-*.js');
const jsViejo = path.join(PUB, 'assets', ref[1]);
let js = fs.readFileSync(jsViejo, 'utf8');

if (js.startsWith(MARCA)) {
  console.log('parche-cliente: ya estaba aplicado');
  process.exit(0);
}

for (const c of CAMBIOS) {
  const n = contar(js, c.viejo);
  if (n !== 1) throw new Error(`parche-cliente: «${c.nombre}» aparece ${n} veces (se esperaba 1)`);
  js = js.replace(c.viejo, () => c.nuevo);
  console.log(`parche-cliente: ${c.nombre} ✓`);
}

for (const c of CAMBIOS_HTML) {
  const n = contar(html, c.viejo);
  if (n !== 1) throw new Error(`parche-cliente: «${c.nombre}» aparece ${n} veces en index.html (se esperaba 1)`);
  html = html.replace(c.viejo, () => c.nuevo);
  console.log(`parche-cliente: ${c.nombre} ✓`);
}

js = MARCA + js;
// Nombre nuevo: los assets se sirven con caché "immutable", así el navegador no usa el viejo.
const hash = crypto.createHash('sha256').update(js).digest('base64url').slice(0, 8);
const nombreNuevo = `index-${hash}.js`;
fs.writeFileSync(path.join(PUB, 'assets', nombreNuevo), js);
fs.unlinkSync(jsViejo);
html = html.replace(`/assets/${ref[1]}`, `/assets/${nombreNuevo}`);
fs.writeFileSync(htmlPath, html);
console.log(`parche-cliente: listo (${ref[1]} -> ${nombreNuevo})`);
