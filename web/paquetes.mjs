// Filtros para los paquetes que mandan los navegadores a las salas (puente WebRTC ⇄ UDP).

// ¿Es un pedido de administración remota (RCON)? En GoldSrc/Xash3D son paquetes "sin
// conexión" (empiezan con FF FF FF FF) con el texto «challenge rcon» o «rcon ...».
// Desde internet no tienen por qué llegar: para administrar están ./servidor.sh y
// web/rcon.mjs, que hablan directo con la sala dentro del servidor.
export function esRcon(paquete) {
    if (!paquete || paquete.length < 8) return false;
    if (paquete[0] !== 0xff || paquete[1] !== 0xff || paquete[2] !== 0xff || paquete[3] !== 0xff) return false;
    const texto = Buffer.from(paquete.subarray(4, 40)).toString('latin1').toLowerCase().trimStart();
    return texto.startsWith('rcon') || texto.startsWith('challenge rcon');
}
