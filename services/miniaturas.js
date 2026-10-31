/**
 * Miniaturas de las fotos de productos.
 *
 * La portada de la tienda muestra las fotos en cuadritos pequeños (cintas), pero las fotos
 * originales pesan ~400 KB cada una. Por cada foto se guarda además una copia pequeña en WebP
 * (~8 KB) junto a la original:
 *
 *   products/123-abc-foto.png  ->  products/mini/123-abc-foto.webp
 *
 * La tienda calcula la dirección de la miniatura a partir de la de la foto (sin cambios en la BD)
 * y, si la miniatura no existe todavía, usa la foto original.
 */
const sharp = require('sharp');

// 320 px de ancho: nítida en los cuadritos de la cinta incluso en pantallas de alta densidad
const ANCHO = 320;
const CALIDAD = 72;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** products/x/foto.png -> products/x/mini/foto.webp (null si ya es una miniatura) */
function claveMiniatura(key) {
  if (!key || /(^|\/)mini\//.test(key)) return null;
  const barra = key.lastIndexOf('/');
  const carpeta = key.slice(0, barra + 1);
  const archivo = key.slice(barra + 1).replace(/\.[^.]+$/, '');
  return `${carpeta}mini/${archivo}.webp`;
}

/** Devuelve la miniatura WebP de una imagen (Buffer). */
function crearMiniatura(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate() // respeta la orientación de fotos tomadas con el celular
    .resize({ width: ANCHO, withoutEnlargement: true })
    .webp({ quality: CALIDAD })
    .toBuffer();
}

module.exports = { claveMiniatura, crearMiniatura, CACHE_CONTROL, ANCHO };
