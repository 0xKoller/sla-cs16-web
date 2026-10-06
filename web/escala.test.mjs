// node --test web/escala.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { ESCALA_MAX, limitarEscala } from './cliente/escala.js';

function ventana(valor) {
  let actual = valor;
  const win = {};
  Object.defineProperty(win, 'devicePixelRatio', { configurable: true, get: () => actual });
  limitarEscala(win);
  return {
    win,
    set actual(v) { actual = v; },
  };
}

test('el tope viaja dentro de la función que se pega en el cliente', () => {
  assert.match(limitarEscala.toString(), /max = 1\.5/);
  assert.equal(ESCALA_MAX, 1.5);
  assert.equal(limitarEscala.toString().includes('ESCALA_MAX'), false);
});

test('una pantalla 1× no cambia', () => {
  const { win } = ventana(1);
  assert.equal(win.devicePixelRatio, 1);
});

test('2× y 3× quedan en el tope', () => {
  const a = ventana(2);
  const b = ventana(3);
  assert.equal(a.win.devicePixelRatio, ESCALA_MAX);
  assert.equal(b.win.devicePixelRatio, ESCALA_MAX);
});

test('un valor entre 1 y el tope se conserva, y sigue al monitor', () => {
  const v = ventana(1.25);
  assert.equal(v.win.devicePixelRatio, 1.25);
  v.actual = 2;
  assert.equal(v.win.devicePixelRatio, ESCALA_MAX);
});
