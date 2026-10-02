// Jugar con las manos: la cámara ve tu mano (MediaPipe Hands, corre en el navegador),
// el índice mueve la mira, bajar el pulgar dispara y la mano abierta recarga.
// Lo arranca marca.js cuando tildás «Apuntar con la mano» (o con ?manos en la dirección).
// Con ?manos=demo no usa la cámara: una mano de prueba se mueve sola (para probar).

import { ControlManos, AJUSTES_INICIALES } from './gestos.js';

const BASE = new URL('./', import.meta.url).href;
const CLAVE = 'cs16:manos';
const CONEXIONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export function leerAjustes() {
    try {
        return { ...AJUSTES_INICIALES, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
    } catch {
        return { ...AJUSTES_INICIALES };
    }
}

export function guardarAjustes(cambios) {
    const nuevos = { ...leerAjustes(), ...cambios };
    try {
        localStorage.setItem(CLAVE, JSON.stringify(nuevos));
    } catch { /* navegador sin almacenamiento: se usan por esta vez */ }
    return nuevos;
}

// ------------------------------------------------------------------ juego
// Habla con el motor (window.xash). Gira con las "teclas" de girar del juego
// (+left/+right/+lookup/+lookdown) a la velocidad justa en cada cuadro: anda con o sin
// el mouse capturado. Con metodo 'mouse' (y el mouse capturado) mueve la mira como si
// fuera el mouse.
const VEL_YAW = 210;    // valores normales del juego, se devuelven al soltar
const VEL_PITCH = 225;

class Juego {
    constructor(metodo = 'teclas') {
        this.metodo = metodo;
        this.restoX = 0;
        this.restoY = 0;
        this.teclas = { yaw: 0, pitch: 0 };
        this.disparando = false;
    }

    get motor() {
        const x = window.xash;
        return x && x.running ? x : null;
    }

    cmd(texto) {
        this.motor?.Cmd_ExecuteString(texto);
    }

    canvas() {
        return document.getElementById('canvas');
    }

    // dx, dy en grados; dt en segundos desde el cuadro anterior
    mirar(dx, dy, dt) {
        if (!this.motor) return;
        const canvas = this.canvas();
        if (this.metodo === 'mouse' && canvas && document.pointerLockElement === canvas) {
            this.soltarTeclas();
            // sensitivity 3 y m_yaw 0.022 (los valores de CS): 1 punto de mouse = 0.066 grados
            const porPunto = 0.022 * 3;
            this.restoX += dx / porPunto;
            this.restoY += dy / porPunto;
            const mx = Math.trunc(this.restoX);
            const my = Math.trunc(this.restoY);
            this.restoX -= mx;
            this.restoY -= my;
            if (mx || my) moverMouse(canvas, mx, my);
        } else {
            this.girarConTeclas(dt > 0 ? dx / dt : 0, dt > 0 ? dy / dt : 0);
        }
    }

    girarConTeclas(velYaw, velPitch) {
        const poner = (eje, vel, cvar, negativo, positivo) => {
            const dir = Math.abs(vel) < 2 ? 0 : Math.sign(vel);
            const actual = this.teclas[eje];
            if (dir !== 0) this.cmd(`${cvar} ${Math.min(Math.abs(vel), 1500).toFixed(1)}`);
            if (dir !== actual) {
                if (actual === 1) this.cmd(`-${positivo}`);
                if (actual === -1) this.cmd(`-${negativo}`);
                if (dir === 1) this.cmd(`+${positivo}`);
                if (dir === -1) this.cmd(`+${negativo}`);
                if (dir === 0) this.cmd(`${cvar} ${cvar === 'cl_yawspeed' ? VEL_YAW : VEL_PITCH}`);
                this.teclas[eje] = dir;
            }
        };
        poner('yaw', velYaw, 'cl_yawspeed', 'left', 'right');
        poner('pitch', velPitch, 'cl_pitchspeed', 'lookup', 'lookdown');
    }

    soltarTeclas() {
        if (this.teclas.yaw || this.teclas.pitch) this.girarConTeclas(0, 0);
    }

    disparar(si) {
        if (si === this.disparando) return;
        this.disparando = si;
        this.cmd(si ? '+attack' : '-attack');
    }

    recargar() {
        this.cmd('+reload');
        setTimeout(() => this.cmd('-reload'), 120);
    }

    soltarTodo() {
        this.disparar(false);
        this.soltarTeclas();
    }
}

function moverMouse(canvas, mx, my) {
    const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, movementX: mx, movementY: my });
    // algunos navegadores ignoran movementX al crear el evento: se fuerza
    if (ev.movementX !== mx) Object.defineProperty(ev, 'movementX', { get: () => mx });
    if (ev.movementY !== my) Object.defineProperty(ev, 'movementY', { get: () => my });
    canvas.dispatchEvent(ev);
}

// ------------------------------------------------------------------ panel
const ESTILO = `
#manos-panel{position:fixed;left:16px;bottom:16px;z-index:4;width:236px;padding:6px;border-radius:10px;
  background:#1f1f1fe6;border:1px solid #ffffff1f;box-shadow:0 12px 40px #0008;color:#f5f5f5;
  font:12px/1.35 Geist,system-ui,sans-serif;-webkit-user-select:none;user-select:none}
#manos-panel canvas{position:static;inset:auto;visibility:visible;display:block;width:224px;height:168px;
  border-radius:7px;background:#111}  /* la página esconde y estira todos los canvas: se anula */
#manos-panel video{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
#manos-panel .fila{display:flex;align-items:center;gap:6px;margin-top:6px}
#manos-panel .estado{flex:1;font-weight:600;letter-spacing:.02em}
#manos-panel .estado::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;
  margin-right:6px;background:var(--c,#a4a4a4);vertical-align:1px}
#manos-panel button{all:unset;cursor:pointer;padding:2px 7px;border-radius:6px;background:#262626;
  border:1px solid #ffffff1f;color:#f5f5f5;font-weight:600}
#manos-panel button:hover{border-color:#0d8750}
#manos-panel .sens{min-width:30px;text-align:center;color:#a4a4a4}
#manos-panel .ayuda{margin-top:5px;color:#a4a4a4;font-size:11px}
#manos-panel.pausa canvas{opacity:.35}
`;

class Panel {
    constructor(ajustes, alCambiar) {
        if (!document.getElementById('manos-estilo')) {
            const st = document.createElement('style');
            st.id = 'manos-estilo';
            st.textContent = ESTILO;
            document.head.append(st);
        }
        this.el = document.createElement('div');
        this.el.id = 'manos-panel';
        this.el.innerHTML = `
          <canvas width="448" height="336"></canvas>
          <div class="fila"><span class="estado">Cargando detector…</span>
            <button data-a="menos" title="Menos sensibilidad">−</button><span class="sens"></span>
            <button data-a="mas" title="Más sensibilidad">+</button>
            <button data-a="pausa" title="Pausar el control con la mano">❚❚</button></div>
          <div class="ayuda">Índice apunta · bajá el pulgar = disparo · mano abierta = recarga</div>`;
        document.body.append(this.el);
        this.canvas = this.el.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.estadoEl = this.el.querySelector('.estado');
        this.sensEl = this.el.querySelector('.sens');
        this.pausado = false;
        this.ajustes = ajustes;
        this.mostrarSens();
        this.el.addEventListener('click', (e) => {
            const a = e.target.closest('button')?.dataset.a;
            if (!a) return;
            if (a === 'pausa') {
                this.pausado = !this.pausado;
                this.el.classList.toggle('pausa', this.pausado);
                e.target.textContent = this.pausado ? '▶' : '❚❚';
                alCambiar({ pausa: this.pausado });
                return;
            }
            const s = Math.round(Math.min(Math.max(this.ajustes.sensibilidad + (a === 'mas' ? 0.1 : -0.1), 0.2), 4) * 10) / 10;
            this.ajustes = guardarAjustes({ sensibilidad: s });
            this.mostrarSens();
            alCambiar({ sensibilidad: s });
        });
    }

    mostrarSens() {
        this.sensEl.textContent = this.ajustes.sensibilidad.toFixed(1);
    }

    estado(texto, color = '#a4a4a4') {
        if (this.estadoEl.textContent !== texto) this.estadoEl.textContent = texto;
        this.estadoEl.style.setProperty('--c', color);
    }

    dibujar(imagen, puntos, salida) {
        const { ctx, canvas } = this;
        const W = canvas.width;
        const H = canvas.height;
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        ctx.translate(W, 0);
        ctx.scale(-1, 1); // espejo: como mirarse
        if (imagen) {
            ctx.globalAlpha = 0.55;
            ctx.drawImage(imagen, 0, 0, W, H);
            ctx.globalAlpha = 1;
        }
        if (puntos) {
            const disparo = salida?.disparando;
            ctx.lineWidth = 3;
            ctx.strokeStyle = disparo ? '#ff5a5f' : '#1fbf75';
            ctx.beginPath();
            for (const [a, b] of CONEXIONES) {
                ctx.moveTo(puntos[a].x * W, puntos[a].y * H);
                ctx.lineTo(puntos[b].x * W, puntos[b].y * H);
            }
            ctx.stroke();
            ctx.fillStyle = '#f5f5f5';
            for (const p of puntos) {
                ctx.beginPath();
                ctx.arc(p.x * W, p.y * H, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            const punta = puntos[8];
            ctx.strokeStyle = '#f5f5f5';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(punta.x * W, punta.y * H, 11, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}

// ----------------------------------------------------------- mano de prueba
// Mano en pose de pistolita que se mueve en círculo y dispara cada tanto (?manos=demo).
const PISTOLA = [[0.406, 0.663, 0], [0.395, 0.536, 0.002], [0.423, 0.434, -0.006], [0.451, 0.346, -0.015], [0.445, 0.272, -0.027], [0.506, 0.478, -0.022], [0.577, 0.467, -0.031], [0.621, 0.465, -0.037], [0.653, 0.469, -0.041], [0.531, 0.547, -0.023], [0.529, 0.541, -0.022], [0.509, 0.541, -0.014], [0.493, 0.552, -0.011], [0.531, 0.619, -0.022], [0.519, 0.593, -0.023], [0.503, 0.597, -0.015], [0.486, 0.607, -0.012], [0.529, 0.68, -0.019], [0.515, 0.655, -0.014], [0.499, 0.656, -0.003], [0.486, 0.661, 0.006]];

function manoDemo(t) {
    const s = t / 1000;
    const dx = Math.sin(s * 0.9) * 0.12;
    const dy = Math.sin(s * 1.3) * 0.05;
    const gatillo = s % 3 > 2.4;
    const [bx, by, bz] = PISTOLA[5];
    return PISTOLA.map(([x, y, z], i) => {
        if (gatillo && i === 4) return { x: bx + 0.012 + dx, y: by + 0.03 + dy, z: bz };
        if (gatillo && i === 3) return { x: bx - 0.02 + dx, y: by + 0.05 + dy, z: bz };
        return { x: x + dx, y: y + dy, z };
    });
}

// ------------------------------------------------------------------ inicio
let activo = null;

export async function iniciar({ demo = false } = {}) {
    if (activo) return activo;
    const ajustes = leerAjustes();
    const control = new ControlManos(ajustes);
    const juego = new Juego(ajustes.metodo);
    let pausa = false;
    const panel = new Panel(ajustes, (cambio) => {
        if ('sensibilidad' in cambio) control.ajustes.sensibilidad = cambio.sensibilidad;
        if ('pausa' in cambio) {
            pausa = cambio.pausa;
            if (pausa) {
                control.sinMano();
                juego.soltarTodo();
            }
        }
    });
    let ultimoT = null;

    const procesar = (puntos, aspecto, imagen) => {
        const t = performance.now();
        const dt = ultimoT === null ? 0 : (t - ultimoT) / 1000;
        ultimoT = t;
        if (pausa) {
            panel.dibujar(imagen, puntos, null);
            panel.estado('En pausa');
            return;
        }
        const out = puntos ? control.actualizar(puntos, aspecto, t) : control.sinMano();
        if (out.mano) {
            juego.mirar(out.dx, out.dy, dt);
            if (out.disparar) juego.disparar(true);
            if (out.soltar) juego.disparar(false);
            if (out.recargar) juego.recargar();
        } else {
            juego.soltarTodo();
        }
        panel.dibujar(imagen, puntos, { disparando: control.disparando });
        if (!juego.motor) panel.estado(out.mano ? 'Mano lista · esperando el juego' : 'Mostrá la mano a la cámara');
        else if (!out.mano) panel.estado('Sin mano', '#a4a4a4');
        else if (control.disparando) panel.estado('¡Fuego!', '#ff5a5f');
        else if (out.recargar || control.recargaHecha) panel.estado('Recargando', '#f5c542');
        else panel.estado('Apuntando', '#1fbf75');
    };

    activo = { control, juego, panel, detener: null };
    window.manos = activo;

    if (demo) {
        panel.estado('Demo (sin cámara)');
        const id = setInterval(() => procesar(manoDemo(performance.now()), 800 / 450, null), 33);
        activo.detener = () => clearInterval(id);
        return activo;
    }

    // --- cámara
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    panel.el.append(video);
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        });
    } catch (e) {
        const motivo = e?.name === 'NotAllowedError'
            ? 'No diste permiso para la cámara'
            : e?.name === 'NotFoundError' ? 'No encontré una cámara' : 'No pude abrir la cámara';
        panel.estado(motivo, '#ff5a5f');
        console.warn('[manos]', e);
        return activo;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});

    // --- detector de manos (archivos locales: no usa internet)
    if (!window.Hands) {
        await new Promise((ok, mal) => {
            const s = document.createElement('script');
            s.src = BASE + 'vendor/hands.js';
            s.onload = ok;
            s.onerror = () => mal(new Error('no cargó hands.js'));
            document.head.append(s);
        });
    }
    const hands = new window.Hands({ locateFile: (f) => BASE + 'vendor/' + f });
    let complejidad = ajustes.liviano ? 0 : 1;
    hands.setOptions({ maxNumHands: 1, modelComplexity: complejidad, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    let ultimoResultado = null;
    hands.onResults((r) => { ultimoResultado = r; });
    panel.estado('Cargando detector…');
    await hands.initialize();

    let corriendo = true;
    const tiempos = [];
    const esperarCuadro = () => new Promise((ok) => {
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => ok());
        else requestAnimationFrame(() => ok());
    });
    (async () => {
        while (corriendo) {
            await esperarCuadro();
            if (!corriendo || video.readyState < 2) continue;
            const t0 = performance.now();
            ultimoResultado = null;
            try {
                await hands.send({ image: video });
            } catch (e) {
                console.warn('[manos]', e);
                continue;
            }
            // si la compu no da abasto, se pasa al modelo liviano
            tiempos.push(performance.now() - t0);
            if (tiempos.length === 90) {
                const prom = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
                if (prom > 40 && complejidad === 1) {
                    complejidad = 0;
                    hands.setOptions({ modelComplexity: 0 });
                    console.info(`[manos] detector lento (${prom.toFixed(0)} ms): uso el modelo liviano`);
                }
            }
            if (tiempos.length > 90) tiempos.shift();
            const pts = ultimoResultado?.multiHandLandmarks?.[0] || null;
            procesar(pts, video.videoWidth / video.videoHeight || 4 / 3, video);
        }
    })();

    activo.detener = () => {
        corriendo = false;
        juego.soltarTodo();
        stream.getTracks().forEach((tr) => tr.stop());
        hands.close?.();
        panel.el.remove();
        activo = null;
    };
    return activo;
}
