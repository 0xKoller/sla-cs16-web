// node --test web/reloj.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { instalarReloj } from './cliente/reloj.js';

function entorno() {
  let now = 0;
  const nativos = [];
  let cancelados = 0;
  const win = {
    performance: { now: () => now },
    document: { hidden: false },
    requestAnimationFrame(cb) {
      const id = nativos.length + 1;
      nativos.push({ id, cb });
      return id;
    },
    cancelAnimationFrame() { cancelados += 1; },
  };
  let onmessage = () => {};
  instalarReloj(win, () => ({
    set onmessage(fn) { onmessage = fn; },
  }));
  return {
    win,
    nativos,
    get cancelados() { return cancelados; },
    set now(v) { now = v; },
    get now() { return now; },
    tick() { onmessage(); },
  };
}

test('un vsync puntual corre el frame y no lo repite el worker', () => {
  const e = entorno();
  let veces = 0;
  let tiempo = -1;
  e.win.requestAnimationFrame((t) => { veces += 1; tiempo = t; });
  e.now = 16;
  e.tick();
  assert.equal(veces, 0);
  e.nativos[0].cb(16.7);
  assert.equal(veces, 1);
  assert.equal(tiempo, 16.7);
  e.now = 100;
  e.tick();
  assert.equal(veces, 1);
});

test('si el vsync no llega, el frame sale antes de los 100 ms y el juego sigue a ~60 Hz', () => {
  const e = entorno();
  const tiempos = [];
  const loop = (t) => {
    tiempos.push(t);
    if (tiempos.length < 8) e.win.requestAnimationFrame(loop);
  };
  e.now = 0;
  e.win.requestAnimationFrame(loop);
  for (let t = 8; tiempos.length < 8 && t < 500; t += 8) {
    e.now = t;
    e.tick();
  }
  assert.ok(tiempos[0] <= 40, `el primer frame tardó ${tiempos[0]} ms`);
  assert.ok(tiempos[0] < 100);
  const periodos = tiempos.slice(1).map((t, i) => t - tiempos[i]);
  for (const p of periodos) {
    assert.ok(p >= 16 && p <= 24, `periodo ${p} ms fuera de un frame`);
  }
  // Durante el trabón no se vuelve a pedir el vsync que no está llegando.
  assert.equal(e.nativos.length, 1);
});

test('cancelar un frame evita que el worker lo dispare', () => {
  const e = entorno();
  let veces = 0;
  const id = e.win.requestAnimationFrame(() => { veces += 1; });
  e.win.cancelAnimationFrame(id);
  e.now = 80;
  e.tick();
  assert.equal(veces, 0);
  assert.equal(e.cancelados, 1);
});

test('una pestaña oculta no fuerza frames', () => {
  const e = entorno();
  let veces = 0;
  e.win.requestAnimationFrame(() => { veces += 1; });
  e.win.document.hidden = true;
  e.now = 80;
  e.tick();
  assert.equal(veces, 0);
});
