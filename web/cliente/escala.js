// En una pantalla retina el motor pide devicePixelRatio (2 o 3) y dibuja
// esa cantidad de píxeles de más. GoldSrc por WebGL2 no llega a un vsync
// con ese buffer. El CSS del canvas sigue en pantalla completa; solo baja
// el bitmap. 1.5 alcanza para que no se vea blando y corta la mayor parte
// del costo (en 2× queda ~56 % de los píxeles, en 3× un cuarto).

export const ESCALA_MAX = 1.5;

export function limitarEscala(win, max = 1.5) {
  const proto = Object.getPrototypeOf(win);
  const desc = Object.getOwnPropertyDescriptor(win, 'devicePixelRatio')
    || (proto && Object.getOwnPropertyDescriptor(proto, 'devicePixelRatio'));
  const leer = desc?.get
    ? () => desc.get.call(win)
    : () => (desc && 'value' in desc ? desc.value : 1);
  Object.defineProperty(win, 'devicePixelRatio', {
    configurable: true,
    get() {
      const real = Number(leer()) || 1;
      return real > max ? max : real;
    },
  });
}
