// Entrar directo al equipo elegido en la pantalla de entrada (sin pasar por el observador
// ni por los menús de equipo y de personaje).
//
// Cómo: se le pregunta «listplayers» al servidor hasta que contesta. Solo contesta (en la
// consola) cuando el jugador ya existe en la partida; recién ahí se manda, UNA sola vez,
// «jointeam» + «joinclass». No se reintenta nunca: en CS, volver a elegir tu equipo
// estando vivo te mata. Si algo no sale, quedan los menús de siempre para elegir a mano.

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Respuesta de «listplayers»: "7 : Nombre" (a veces con la hora adelante: "[01:51:04] 7 : Nombre")
export const RESPUESTA_LISTPLAYERS = /(?:^|\]\s*)\d+ : \S/;

export async function esperarMotor(ms, ventana = globalThis) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
        if (ventana.xash?.running) return ventana.xash;
        await dormir(250);
    }
    return null;
}

// equipo: 1 terroristas, 2 antiterroristas, 5 automático
export async function entrarAlEquipo(equipo, motor = null, opciones = {}) {
    const { espera = 180000, pausa = 1000, margen = 400, consola = console } = opciones;
    motor = motor || await esperarMotor(120000);
    if (!motor) return false;
    let adentro = false;
    const original = consola.log;
    const envoltura = function (...args) {
        try {
            if (!adentro && RESPUESTA_LISTPLAYERS.test(String(args[0] ?? ''))) adentro = true;
        } catch { /* nada */ }
        return original.apply(this, args);
    };
    consola.log = envoltura;
    try {
        const fin = Date.now() + espera;
        while (!adentro && Date.now() < fin) {
            motor.Cmd_ExecuteString('listplayers');
            for (let t = 0; t < pausa && !adentro; t += 50) await dormir(50);
        }
    } finally {
        if (consola.log === envoltura) consola.log = original;
    }
    if (!adentro) return false;
    // un instante para que el servidor termine de ubicarte (lo pasa al menú de equipos)
    await dormir(margen);
    motor.Cmd_ExecuteString(`jointeam ${equipo}`);
    motor.Cmd_ExecuteString('joinclass 5');   // aspecto automático
    return true;
}
