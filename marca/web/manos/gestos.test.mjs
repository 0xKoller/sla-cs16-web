// Pruebas de los gestos con puntos armados a mano (no hace falta cámara).
// Correr: node --test marca/web/manos/gestos.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlManos, analizar, normalizar, P } from './gestos.js';

// Mano en pose de "pistolita" (puntos reales de una foto, imagen 800x450).
const ASPECTO = 800 / 450;
const PISTOLA = [[0.406, 0.663, 0], [0.395, 0.536, 0.002], [0.423, 0.434, -0.006], [0.451, 0.346, -0.015], [0.445, 0.272, -0.027], [0.506, 0.478, -0.022], [0.577, 0.467, -0.031], [0.621, 0.465, -0.037], [0.653, 0.469, -0.041], [0.531, 0.547, -0.023], [0.529, 0.541, -0.022], [0.509, 0.541, -0.014], [0.493, 0.552, -0.011], [0.531, 0.619, -0.022], [0.519, 0.593, -0.023], [0.503, 0.597, -0.015], [0.486, 0.607, -0.012], [0.529, 0.68, -0.019], [0.515, 0.655, -0.014], [0.499, 0.656, -0.003], [0.486, 0.661, 0.006]]
    .map(([x, y, z]) => ({ x, y, z }));

const mover = (pts, dx, dy = 0) => pts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
const conPulgarBajado = (pts) => pts.map((p, i) => {
    // el pulgar se apoya al costado del índice, cerca de su base
    if (i === 4) return { x: pts[5].x + 0.012, y: pts[5].y + 0.03, z: pts[5].z };
    if (i === 3) return { x: pts[5].x - 0.02, y: pts[5].y + 0.05, z: pts[5].z };
    return p;
});
const abierta = (pts) => pts.map((p, i) => {
    const w = pts[0];
    const estirar = { 12: 10, 16: 14, 20: 18, 11: 10, 15: 14, 19: 18 };
    if (i in estirar) {
        const m = pts[estirar[i]];
        const f = i % 4 === 0 ? 2.0 : 1.5;
        return { x: w.x + (m.x - w.x) * f, y: w.y + (m.y - w.y) * f, z: p.z };
    }
    return p;
});

test('reconoce la pistolita con el pulgar arriba', () => {
    const info = analizar(normalizar(PISTOLA, ASPECTO));
    assert.equal(info.pistola, true);
    assert.equal(info.abierta, false);
    assert.ok(info.pulgar > 0.8, `pulgar ${info.pulgar}`);
    assert.ok(analizar(normalizar(conPulgarBajado(PISTOLA), ASPECTO)).pulgar < 0.45);
});

test('bajar el pulgar dispara una vez y subirlo suelta', () => {
    const c = new ControlManos();
    let t = 0;
    const paso = (pts) => c.actualizar(pts, ASPECTO, (t += 33));
    for (let i = 0; i < 10; i++) assert.equal(paso(PISTOLA).disparar, false);
    const r1 = paso(conPulgarBajado(PISTOLA));
    assert.equal(r1.disparar, true);
    for (let i = 0; i < 5; i++) {
        const r = paso(conPulgarBajado(PISTOLA));
        assert.equal(r.disparar, false);   // ya está disparando: no repite
        assert.equal(r.soltar, false);
    }
    assert.equal(paso(PISTOLA).soltar, true);
    assert.equal(paso(PISTOLA).soltar, false);
});

test('la mira sigue al dedo: mover un décimo de la imagen gira ~11 grados', () => {
    const c = new ControlManos({ zonaBorde: 0.45 });
    let t = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) c.actualizar(PISTOLA, ASPECTO, (t += 33));
    // la imagen se ve espejada: mover la mano hacia x menor en la cámara = a la derecha
    for (let i = 0; i < 40; i++) total += c.actualizar(mover(PISTOLA, -0.1), ASPECTO, (t += 33)).dx;
    assert.ok(total > 10 && total < 11.5, `giró ${total}`);
    let vertical = 0;
    for (let i = 0; i < 40; i++) vertical += c.actualizar(mover(PISTOLA, -0.1, 0.1), ASPECTO, (t += 33)).dy;
    assert.ok(vertical > 6 && vertical < 7, `vertical ${vertical}`);
});

test('el temblor chico casi no mueve la mira', () => {
    const c = new ControlManos({ zonaBorde: 0.45 });
    let t = 0;
    let total = 0;
    let s = 1;
    const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < 300; i++) {
        const r = c.actualizar(mover(PISTOLA, azar() * 0.004, azar() * 0.004), ASPECTO, (t += 33));
        total += Math.abs(r.dx);
    }
    assert.ok(total / 300 < 0.08, `promedio ${total / 300} grados por cuadro`);
});

test('con la mano en el borde sigue girando', () => {
    const c = new ControlManos();
    let t = 0;
    const borde = mover(PISTOLA, -0.6); // la punta queda bien a la derecha (espejado)
    c.actualizar(borde, ASPECTO, (t += 33));
    let total = 0;
    for (let i = 0; i < 30; i++) total += c.actualizar(borde, ASPECTO, (t += 33)).dx;
    assert.ok(total > 20, `giró ${total} en un segundo`);
});

test('mano abierta un rato recarga una sola vez', () => {
    const c = new ControlManos();
    let t = 0;
    const mano = abierta(PISTOLA);
    assert.equal(analizar(normalizar(mano, ASPECTO)).abierta, true);
    let recargas = 0;
    for (let i = 0; i < 40; i++) if (c.actualizar(mano, ASPECTO, (t += 33)).recargar) recargas++;
    assert.equal(recargas, 1);
    c.actualizar(PISTOLA, ASPECTO, (t += 33));
    for (let i = 0; i < 20; i++) if (c.actualizar(mano, ASPECTO, (t += 33)).recargar) recargas++;
    assert.equal(recargas, 2);
});

test('si se pierde la mano suelta el disparo y no salta la mira al volver', () => {
    const c = new ControlManos({ zonaBorde: 0.45 });
    let t = 0;
    for (let i = 0; i < 5; i++) c.actualizar(PISTOLA, ASPECTO, (t += 33));
    c.actualizar(conPulgarBajado(PISTOLA), ASPECTO, (t += 33));
    assert.equal(c.sinMano().soltar, true);
    const r = c.actualizar(mover(PISTOLA, -0.2), ASPECTO, (t += 500));
    assert.equal(r.dx, 0);
});

test('pellizco como gatillo alternativo', () => {
    const c = new ControlManos({ gatillo: 'pellizco' });
    let t = 0;
    const pellizco = PISTOLA.map((p, i) => (i === P.PULGAR_PUNTA ? { ...PISTOLA[P.INDICE_PUNTA] } : p));
    c.actualizar(PISTOLA, ASPECTO, (t += 33));
    assert.equal(c.actualizar(pellizco, ASPECTO, (t += 33)).disparar, true);
    assert.equal(c.actualizar(PISTOLA, ASPECTO, (t += 33)).soltar, true);
});
