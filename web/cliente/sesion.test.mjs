// node --test web/cliente/sesion.test.mjs
// Motivos de corte: qué cartel se muestra según lo que escribe el motor en la consola.
import assert from 'node:assert/strict';
import test from 'node:test';
import { motivoDe } from './sesion.js';

test('reconoce por qué se cortó la conexión', () => {
    assert.equal(motivoDe('^1Server was reject the connection:^7 invalid password')?.id, 'clave');
    assert.equal(motivoDe('Server was reject the connection: BADPASSWORD')?.id, 'clave');
    assert.equal(motivoDe('^1Server was reject the connection:^7 Server is full.')?.id, 'rechazo');
    assert.equal(motivoDe('You were kicked from the game with message: "afk"')?.id, 'echado');
    assert.equal(motivoDe('Server issued disconnect. Reason: Server shutting down')?.id, 'sala');
    assert.equal(motivoDe('Server shutdown')?.id, 'sala');
});

test('no confunde mensajes normales del juego', () => {
    for (const t of ['Server disconnected, reconnecting', 'iamblazed killed Counter123 with ak47',
        '7 : QA-movil', 'Couldn\'t open file overviews/de_dust2.txt', 'red devil was kicked',
        'BorHor was kicked with message: "Bot removed"']) {
        assert.equal(motivoDe(t), null, t);   // que saquen a otro (un bot) no es tu corte
    }
});
