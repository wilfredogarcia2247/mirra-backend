const sharp = require('sharp');
const { claveMiniatura, crearMiniatura } = require('../services/miniaturas');

describe('miniaturas de fotos de productos', () => {
  test('la miniatura va en la carpeta mini/ con extensión .webp', () => {
    expect(claveMiniatura('products/1769-abc-foto.png')).toBe('products/mini/1769-abc-foto.webp');
    // Algunas fotos tienen doble extensión: solo se cambia la última
    expect(claveMiniatura('products/1769-abc-2026-01-23_15-50.png.png')).toBe('products/mini/1769-abc-2026-01-23_15-50.png.webp');
  });

  test('una miniatura no genera otra miniatura', () => {
    expect(claveMiniatura('products/mini/foto.webp')).toBeNull();
    expect(claveMiniatura('')).toBeNull();
  });

  test('achica la foto a 320 px de ancho en WebP y pesa mucho menos', async () => {
    const original = await sharp({ create: { width: 800, height: 640, channels: 4, background: '#c9a650' } })
      .composite([{ input: Buffer.from('<svg width="800" height="640"><circle cx="400" cy="320" r="250" fill="#fff"/></svg>') }])
      .png().toBuffer();
    const mini = await crearMiniatura(original);
    const info = await sharp(mini).metadata();
    expect(info.format).toBe('webp');
    expect(info.width).toBe(320);
    expect(info.height).toBe(256);
    expect(mini.length).toBeLessThan(original.length);
  });

  test('no agranda fotos más pequeñas que 320 px', async () => {
    const chica = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#fff' } }).png().toBuffer();
    const info = await sharp(await crearMiniatura(chica)).metadata();
    expect(info.width).toBe(200);
  });
});
