// El motor dibuja con WebGL2 y pide cada frame con requestAnimationFrame.
// Chrome a veces no entrega ese callback mientras la GPU termina el frame
// (pantalla completa, puntero capturado, un frame largo de wasm). El parche
// anterior esperaba 100 ms y recién ahí lo disparaba: la imagen se quedaba
// quieta y después seguía. Acá, si el vsync no llega, un worker —su timer no
// depende del compositor— sigue el bucle a ~60 Hz hasta que el navegador
// vuelve a ser puntual.

const LIMITE_RAF_MS = 36; // un vsync de 60 Hz (~16 ms) o 30 Hz (~33 ms) entra; más que eso es un trabón
const VSYNC_MS = 16;
const DEGRADE_MS = 400;

export function instalarReloj(win, crearWorker = (codigo) => new Worker(URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' })))) {
  const nativo = win.requestAnimationFrame.bind(win);
  const cancelarNativo = win.cancelAnimationFrame.bind(win);
  const ahora = () => win.performance.now();
  const pending = new Map();
  let seq = 1;
  let degradadoHasta = 0;

  function disparar(rec, tiempo) {
    if (rec.listo) return;
    rec.listo = true;
    pending.delete(rec.id);
    if (rec.rafId) cancelarNativo(rec.rafId);
    rec.cb(tiempo);
  }

  const worker = crearWorker('setInterval(() => postMessage(0), 8);');
  worker.onmessage = () => {
    if (win.document.hidden) return;
    const t = ahora();
    for (const rec of [...pending.values()]) {
      if (rec.listo) continue;
      if (rec.rafId) {
        if (t - rec.desde < LIMITE_RAF_MS) continue;
        degradadoHasta = t + DEGRADE_MS;
      } else if (t - rec.desde < VSYNC_MS) continue;
      disparar(rec, t);
    }
  };

  win.requestAnimationFrame = (cb) => {
    const t = ahora();
    const rec = { cb, desde: t, listo: false, id: seq++, rafId: 0 };
    // Mientras el vsync está trabado no lo volvemos a pedir: cada frame
    // esperaría el límite y el juego se vería a tirones.
    if (t >= degradadoHasta) rec.rafId = nativo((ts) => disparar(rec, ts));
    pending.set(rec.id, rec);
    return rec.id;
  };

  win.cancelAnimationFrame = (id) => {
    const rec = pending.get(id);
    if (!rec) return;
    rec.listo = true;
    pending.delete(id);
    if (rec.rafId) cancelarNativo(rec.rafId);
  };
}
