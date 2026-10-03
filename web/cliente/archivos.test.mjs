// node --test web/cliente/archivos.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { incluir, normalizarRuta, seleccionar } from './archivos.js';

test('encuentra valve/ y cstrike/ sin importar qué carpeta eligió', () => {
    assert.equal(normalizarRuta('Half-Life/cstrike/maps/de_dust2.bsp'), 'cstrike/maps/de_dust2.bsp');
    assert.equal(normalizarRuta('common/Half-Life/valve/halflife.wad'), 'valve/halflife.wad');
    assert.equal(normalizarRuta('cstrike/liblist.gam'), 'cstrike/liblist.gam');
    assert.equal(normalizarRuta('Half-Life\\valve\\gfx.wad'), 'valve/gfx.wad');
    assert.equal(normalizarRuta('Half-Life/hl.exe'), null);
    assert.equal(normalizarRuta('Half-Life/cstrike'), null);
    assert.equal(normalizarRuta('Half-Life/cstrike/.DS_Store'), null);
});

test('deja afuera código y carpetas que el navegador no usa', () => {
    assert.equal(incluir('cstrike/maps/de_dust2.bsp'), true);
    assert.equal(incluir('valve/halflife.wad'), true);
    assert.equal(incluir('valve/maps/c1a0.bsp'), false);      // mapas de Half-Life
    assert.equal(incluir('cstrike/dlls/mp.dll'), false);
    assert.equal(incluir('cstrike/cl_dlls/client.so'), false);
    assert.equal(incluir('cstrike/hw.dll'), false);
    assert.equal(incluir('valve/steam_appid.vdf'), false);
    assert.equal(incluir('valve_hd/models/x.mdl'), false);     // otras carpetas
    assert.equal(incluir('cstrike/sound/maps.wav'), true);     // "maps" no es la carpeta
});

test('avisa si falta algo necesario', () => {
    const f = (ruta, size = 3) => ({ webkitRelativePath: ruta, size });
    const bien = seleccionar([
        f('Half-Life/valve/halflife.wad'), f('Half-Life/cstrike/liblist.gam'),
        f('Half-Life/cstrike/maps/de_dust2.bsp'), f('Half-Life/cstrike/dlls/mp.dll'),
    ]);
    assert.deepEqual(bien.faltan, []);
    assert.equal(bien.elegidos.size, 3);
    const mal = seleccionar([f('Descargas/foto.jpg'), f('cstrike/liblist.gam')]);
    assert.deepEqual(mal.faltan, ['valve/halflife.wad', 'cstrike/maps/de_dust2.bsp']);
});
