// Prueba del giro con "teclas": un motor de mentira integra la velocidad como el juego
// (cl_yawspeed * tiempo mientras +left/+right está apretado) y se compara con lo pedido.
// Correr: node --test marca/web/manos/juego.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

let ahora = 0;
const motor = {
    running: true,
    yaw: 0, pitch: 0, velYaw: 210, velPitch: 225,
    teclas: new Set(),
    Cmd_ExecuteString(c) {
        const [cmd, val] = c.split(' ');
        if (cmd === 'cl_yawspeed') this.velYaw = Number(val);
        else if (cmd === 'cl_pitchspeed') this.velPitch = Number(val);
        else if (cmd[0] === '+') this.teclas.add(cmd.slice(1));
        else if (cmd[0] === '-') this.teclas.delete(cmd.slice(1));
    },
    cuadro(dt) { // un cuadro del juego
        const t = this.teclas;
        this.yaw += ((t.has('right') ? 1 : 0) - (t.has('left') ? 1 : 0)) * this.velYaw * dt;
        this.pitch += ((t.has('lookdown') ? 1 : 0) - (t.has('lookup') ? 1 : 0)) * this.velPitch * dt;
    },
};
globalThis.window = { xash: motor };
globalThis.document = { getElementById: () => null, pointerLockElement: null };
const { Juego } = await import('./manos.js');

// corre `seg` segundos: el juego a 60 cuadros por segundo, la cámara a 30
function simular(juego, seg, movimiento) {
    let pedido = 0;
    const pasos = Math.round(seg * 60);
    for (let i = 0; i < pasos; i++) {
        ahora += 1000 / 60;
        if (i % 2 === 0) {
            const d = movimiento(i / 60);
            pedido += d;
            juego.mirar(d, 0, 1 / 30);
        }
        motor.cuadro(1 / 60);
    }
    return pedido;
}

test('movimientos chiquitos del dedo también giran (no se traba)', () => {
    motor.yaw = 0;
    const j = new Juego('teclas', () => ahora);
    const pedido = simular(j, 3, () => 0.05); // 1.5 grados por segundo
    simular(j, 0.5, () => 0);
    assert.ok(Math.abs(motor.yaw - pedido) < 0.25, `pedido ${pedido.toFixed(2)} girado ${motor.yaw.toFixed(2)}`);
});

test('un giro rápido llega completo y no se pasa', () => {
    motor.yaw = 0;
    const j = new Juego('teclas', () => ahora);
    const pedido = simular(j, 0.3, () => 2) + simular(j, 1, () => 0);
    assert.ok(Math.abs(motor.yaw - pedido) < 1.5, `pedido ${pedido.toFixed(1)} girado ${motor.yaw.toFixed(1)}`);
});

test('ida y vuelta queda donde empezó', () => {
    motor.yaw = 0;
    const j = new Juego('teclas', () => ahora);
    simular(j, 0.5, () => 1.5);
    simular(j, 0.5, () => -1.5);
    simular(j, 0.5, () => 0);
    assert.ok(Math.abs(motor.yaw) < 1, `quedó en ${motor.yaw.toFixed(2)}`);
});

test('si la cámara deja de mandar datos, el giro frena solo', async () => {
    motor.yaw = 0;
    const j = new Juego('teclas', () => ahora);
    j.mirar(5, 0, 1 / 30);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(motor.teclas.size, 0);
    assert.equal(motor.velYaw, 210); // vuelve la velocidad normal de las flechas
});
