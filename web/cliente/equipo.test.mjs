// node --test web/cliente/equipo.test.mjs
// Entrar directo al equipo: «jointeam» se manda una sola vez y solo cuando el servidor ya
// contestó «listplayers» (repetirlo estando vivo te mata en CS).
import assert from 'node:assert/strict';
import test from 'node:test';
import { RESPUESTA_LISTPLAYERS, entrarAlEquipo } from './equipo.js';

// Motor falso: imprime en la consola como el de verdad (module.print -> console.log)
function motorFalso(consola, { conectaEn = 3 } = {}) {
    const comandos = [];
    let pedidos = 0;
    return {
        comandos,
        Cmd_ExecuteString(c) {
            comandos.push(c);
            if (c !== 'listplayers') return;
            pedidos++;
            setTimeout(() => {
                if (pedidos < conectaEn) consola.log('Can\'t "listplayers", not connected');
                else {
                    consola.log('[01:51:04] ');
                    consola.log('1 : CheezyPinoy');
                    consola.log('7 : Shuga');
                }
            }, 5);
        },
    };
}

test('la respuesta de listplayers se reconoce y lo demás no', () => {
    for (const t of ['7 : Shuga', '[01:51:04] 12 : red devil', '3 : (1)Shuga'])
        assert.ok(RESPUESTA_LISTPLAYERS.test(t), t);
    for (const t of ['Can\'t "listplayers", not connected', '[01:47:44] red devil killed CheezyPinoy with galil',
        '*** red devil killed CheezyPinoy with a headshot from galil ***', 'touch_enable is read-only.', '[01:51:04] '])
        assert.ok(!RESPUESTA_LISTPLAYERS.test(t), t);
});

test('espera a estar adentro y manda jointeam + joinclass una sola vez', async () => {
    const consola = { log() {} };
    const original = consola.log;
    const motor = motorFalso(consola, { conectaEn: 3 });
    const ok = await entrarAlEquipo(1, motor, { pausa: 100, margen: 10, consola });
    assert.equal(ok, true);
    assert.deepEqual(motor.comandos, ['listplayers', 'listplayers', 'listplayers', 'jointeam 1', 'joinclass 5']);
    assert.equal(consola.log, original, 'devuelve la consola como estaba');
});

test('si nunca entra, no manda jointeam', async () => {
    const consola = { log() {} };
    const motor = motorFalso(consola, { conectaEn: Infinity });
    const ok = await entrarAlEquipo(2, motor, { espera: 350, pausa: 100, margen: 10, consola });
    assert.equal(ok, false);
    assert.ok(motor.comandos.length >= 2 && motor.comandos.every((c) => c === 'listplayers'));
});
