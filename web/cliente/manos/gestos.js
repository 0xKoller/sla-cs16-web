// Gestos de la mano para jugar: apuntar con el índice, disparar bajando el pulgar
// (o pellizcando) y recargar con la mano abierta. Solo cálculos: no toca la cámara ni
// el juego, así se puede probar aparte (node --test marca/web/manos/gestos.test.mjs).
//
// Recibe los 21 puntos de MediaPipe Hands (x, y normalizados a la imagen; z en la misma
// escala que x) y devuelve cuánto mover la mira (en grados) y si hay que disparar.

// Índices de los puntos de MediaPipe Hands
export const P = {
    MUNECA: 0,
    PULGAR_PUNTA: 4,
    INDICE_BASE: 5, INDICE_MEDIO: 6, INDICE_PUNTA: 8,
    MEDIO_BASE: 9, MEDIO_MEDIO: 10, MEDIO_PUNTA: 12,
    ANULAR_MEDIO: 14, ANULAR_PUNTA: 16,
    MENIQUE_MEDIO: 18, MENIQUE_PUNTA: 20,
};

export const AJUSTES_INICIALES = {
    sensibilidad: 1,          // multiplica todo el movimiento de la mira
    gradosAncho: 80,          // cruzar la imagen de la cámara de punta a punta gira esto (a velocidad media)
    gradosAlto: 50,           // de arriba a abajo
    aceleracion: true,        // movimientos lentos más precisos, rápidos más amplios (como un mouse)
    zonaBorde: 0.2,           // distancia al centro (en anchos de imagen) donde empieza el giro continuo
    zonaBordeMax: 0.42,       // ... y donde llega a la velocidad máxima
    velocidadBorde: 150,      // grados por segundo con la mano en el borde
    graciaMs: 250,            // si la cámara pierde la mano menos que esto, no se corta nada
    invertirY: false,
    gatillo: 'pulgar',        // 'pulgar' (pistolita) o 'pellizco'
    recargaMs: 450,           // mano abierta este tiempo = recargar
    metodo: 'teclas',         // cómo se mueve la mira: 'teclas' (siempre anda) o 'mouse'
    liviano: false,           // modelo de mano liviano (más rápido, menos preciso)
};

// ------------------------------------------------------------------ filtro
// Filtro "One Euro" (Casiez et al. 2012): suaviza el temblor cuando la mano está quieta
// y casi no agrega retraso cuando se mueve rápido.
class FiltroBajo {
    constructor() { this.y = null; }
    filtrar(x, alfa) {
        this.y = this.y === null ? x : alfa * x + (1 - alfa) * this.y;
        return this.y;
    }
}

export class FiltroOneEuro {
    constructor({ minCorte = 1.0, beta = 10, corteDerivada = 1 } = {}) {
        Object.assign(this, { minCorte, beta, corteDerivada });
        this.reiniciar();
    }
    reiniciar() {
        this.x = new FiltroBajo();
        this.dx = new FiltroBajo();
        this.ultimoT = null;
        this.ultimoX = null;
    }
    static alfa(corte, dt) {
        const tau = 1 / (2 * Math.PI * corte);
        return 1 / (1 + tau / dt);
    }
    filtrar(x, t) {
        if (this.ultimoT === null) {
            this.ultimoT = t;
            this.ultimoX = x;
            this.dx.filtrar(0, 1);
            return this.x.filtrar(x, 1);
        }
        const dt = Math.max((t - this.ultimoT) / 1000, 1e-3);
        const derivada = (x - this.ultimoX) / dt;
        const dxSuave = this.dx.filtrar(derivada, FiltroOneEuro.alfa(this.corteDerivada, dt));
        const corte = this.minCorte + this.beta * Math.abs(dxSuave);
        this.ultimoT = t;
        this.ultimoX = x;
        return this.x.filtrar(x, FiltroOneEuro.alfa(corte, dt));
    }
}

// ------------------------------------------------------------- geometría
// Pasa los puntos a unidades parejas (alto de la imagen = 1) y espejados, como un espejo:
// mover la mano a la derecha mueve la mira a la derecha.
export function normalizar(puntos, aspecto) {
    return puntos.map((p) => ({ x: (1 - p.x) * aspecto, y: p.y, z: (p.z || 0) * aspecto }));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Mira la forma de la mano. `pts` ya normalizados.
export function analizar(pts) {
    const escala = dist(pts[P.MUNECA], pts[P.MEDIO_BASE]) || 1e-6;
    const estirado = (punta, medio) => dist(pts[P.MUNECA], pts[punta]) > dist(pts[P.MUNECA], pts[medio]) * 1.12;
    const dedos = {
        indice: estirado(P.INDICE_PUNTA, P.INDICE_MEDIO),
        medio: estirado(P.MEDIO_PUNTA, P.MEDIO_MEDIO),
        anular: estirado(P.ANULAR_PUNTA, P.ANULAR_MEDIO),
        menique: estirado(P.MENIQUE_PUNTA, P.MENIQUE_MEDIO),
    };
    // Pulgar: qué tan lejos está la punta del pulgar de la base del índice.
    // Pulgar arriba (pistolita lista) ~0.8-1.0; pulgar bajado (gatillo) ~0.2-0.4.
    const pulgar = dist(pts[P.PULGAR_PUNTA], pts[P.INDICE_BASE]) / escala;
    const pellizco = dist(pts[P.PULGAR_PUNTA], pts[P.INDICE_PUNTA]) / escala;
    const abierta = dedos.indice && dedos.medio && dedos.anular && dedos.menique && pulgar > 0.75;
    const pistola = dedos.indice && !dedos.medio && !dedos.anular;
    return { escala, dedos, pulgar, pellizco, abierta, pistola, punta: pts[P.INDICE_PUNTA] };
}

// ---------------------------------------------------------------- control
export class ControlManos {
    constructor(ajustes = {}) {
        this.ajustes = { ...AJUSTES_INICIALES, ...ajustes };
        this.fx = new FiltroOneEuro();
        this.fy = new FiltroOneEuro();
        this.anterior = null;
        this.disparando = false;
        this.pulgarArriba = 0.9;   // nivel del pulgar levantado, se va aprendiendo
        this.abiertaDesde = null;
        this.recargaHecha = false;
        this.ultimoT = null;
        this.vistaT = null;        // última vez que se vio la mano
        this.ultimo = null;        // último análisis (para el panel)
    }

    // Sin mano a la vista. Si se perdió hace muy poco (la cámara parpadea, el dedo se
    // movió rápido) se espera sin cortar el disparo; después se suelta todo.
    // Sin `t` suelta enseguida (pausa).
    sinMano(t) {
        if (t !== undefined && this.vistaT !== null && t - this.vistaT < this.ajustes.graciaMs) {
            return { dx: 0, dy: 0, disparar: false, soltar: false, recargar: false, mano: true, perdida: true };
        }
        this.vistaT = null;
        this.fx.reiniciar();
        this.fy.reiniciar();
        this.anterior = null;
        this.abiertaDesde = null;
        this.ultimoT = null;
        this.ultimo = null;
        const soltar = this.disparando;
        this.disparando = false;
        return { dx: 0, dy: 0, disparar: false, soltar, recargar: false, mano: false };
    }

    // puntos: 21 puntos de MediaPipe; aspecto: ancho/alto de la imagen; t: milisegundos
    actualizar(puntos, aspecto, t) {
        const a = this.ajustes;
        const pts = normalizar(puntos, aspecto);
        const info = analizar(pts);
        this.ultimo = info;
        const dt = this.ultimoT === null ? 0 : Math.min((t - this.ultimoT) / 1000, 0.25);
        this.ultimoT = t;
        this.vistaT = t;

        // --- mira: sigue la punta del índice (filtrada)
        const x = this.fx.filtrar(info.punta.x, t);
        const y = this.fy.filtrar(info.punta.y, t);
        let dx = 0;
        let dy = 0;
        if (this.anterior) {
            // en anchos/altos de imagen; un salto enorme (mano perdida y vuelta) se recorta
            const mx = Math.max(-0.2, Math.min(0.2, (x - this.anterior.x) / aspecto));
            const my = Math.max(-0.2, Math.min(0.2, y - this.anterior.y));
            let ganancia = a.sensibilidad;
            if (a.aceleracion && dt > 0) {
                // 0.6x moviendo despacio, hasta 1.4x moviendo rápido (1.5 anchos por segundo)
                const vel = Math.hypot(mx, my) / dt;
                ganancia *= 0.6 + 0.8 * Math.min(vel / 1.5, 1);
            }
            dx = mx * a.gradosAncho * ganancia;
            dy = my * a.gradosAlto * ganancia;
        }
        this.anterior = { x, y };
        // giro continuo con la mano cerca del borde izquierdo o derecho (arranca suave)
        const desdeCentro = x / aspecto - 0.5;
        const ancho = Math.max(a.zonaBordeMax - a.zonaBorde, 0.01);
        const f = Math.min(Math.max((Math.abs(desdeCentro) - a.zonaBorde) / ancho, 0), 1);
        if (f > 0 && dt > 0) {
            const suave = f * f * (3 - 2 * f);
            dx += Math.sign(desdeCentro) * suave * a.velocidadBorde * dt;
        }
        if (a.invertirY) dy = -dy;

        // --- gatillo, con histéresis para que no tiemble
        let disparar = false;
        let soltar = false;
        if (a.gatillo === 'pellizco') {
            if (!this.disparando && info.pellizco < 0.28) disparar = true;
            else if (this.disparando && info.pellizco > 0.42) soltar = true;
        } else {
            // se adapta a cada mano: compara con cómo tenés el pulgar cuando no disparás
            if (!this.disparando && info.pulgar > this.pulgarArriba * 0.75) {
                this.pulgarArriba += (info.pulgar - this.pulgarArriba) * 0.05;
            }
            this.pulgarArriba = Math.min(Math.max(this.pulgarArriba, 0.55), 1.3);
            if (!this.disparando && info.pulgar < this.pulgarArriba * 0.55) disparar = true;
            else if (this.disparando && info.pulgar > this.pulgarArriba * 0.72) soltar = true;
        }
        if (disparar) this.disparando = true;
        if (soltar) this.disparando = false;

        // --- recargar: mano abierta un rato (una vez por cada vez que la abrís)
        let recargar = false;
        if (info.abierta) {
            this.abiertaDesde ??= t;
            if (!this.recargaHecha && t - this.abiertaDesde >= a.recargaMs) {
                recargar = true;
                this.recargaHecha = true;
            }
        } else {
            this.abiertaDesde = null;
            this.recargaHecha = false;
        }
        return { dx, dy, disparar, soltar, recargar, mano: true, info };
    }
}
