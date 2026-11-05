const sharp = require('sharp');
const { claveMiniatura, crearMiniatura } = require('../services/miniaturas');

describe('fotos livianas de las cintas', () => {
  test('la copia va en la carpeta cinta/ con extensión .webp', () => {
    expect(claveMiniatura('products/1769-abc-foto.png')).toBe('products/cinta/1769-abc-foto.webp');
    // Algunas fotos tienen doble extensión: solo se cambia la última
    expect(claveMiniatura('products/1769-abc-2026-01-23_15-50.png.png')).toBe('products/cinta/1769-abc-2026-01-23_15-50.png.webp');
  });

  test('una copia (nueva o de la carpeta vieja mini/) no genera otra copia', () => {
    expect(claveMiniatura('products/cinta/foto.webp')).toBeNull();
    expect(claveMiniatura('products/mini/foto.webp')).toBeNull();
    expect(claveMiniatura('')).toBeNull();
  });

  test('mantiene el tamaño de las fotos del catálogo, en WebP y pesa menos', async () => {
    const original = await sharp({ create: { width: 734, height: 648, channels: 4, background: '#c9a650' } })
      .composite([{ input: Buffer.from('<svg width="734" height="648"><circle cx="367" cy="324" r="250" fill="#fff"/></svg>') }])
      .png().toBuffer();
    const copia = await crearMiniatura(original);
    const info = await sharp(copia).metadata();
    expect(info.format).toBe('webp');
    expect(info.width).toBe(734);
    expect(info.height).toBe(648);
    expect(copia.length).toBeLessThan(original.length);
  });

  test('solo achica fotos enormes (lado mayor a 1000 px)', async () => {
    const grande = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#fff' } }).png().toBuffer();
    const info = await sharp(await crearMiniatura(grande)).metadata();
    expect(info.width).toBe(1000);
    expect(info.height).toBe(750);
  });
});
