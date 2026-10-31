/**
 * Fotos livianas para las cintas de la portada.
 *
 * Las fotos originales son PNG de ~400 KB. Por cada foto se guarda además una copia en WebP
 * del MISMO tamaño en píxeles (no se achica, así se ve igual de nítida en teléfonos y en PC con
 * zoom) con calidad 90. Pesa ~45 KB en promedio, casi 10 veces menos. Medido el 2026-10-31 con
 * las 307 fotos del catálogo: a simple vista no se distingue de la original.
 *
 *   products/123-abc-foto.png  ->  products/cinta/123-abc-foto.webp
 *
 * Carpeta cinta/ (antes mini/, con fotos de 320 px que se veían borrosas): con un nombre nuevo
 * los navegadores no reutilizan las miniaturas viejas que guardaron por un año.
 * La tienda calcula la dirección a partir de la de la foto (sin cambios en la BD)
 * y, si la copia no existe todavía, usa la foto original.
 */
const sharp = require('sharp');

// Solo se achican fotos enormes (más de 1000 px); las del catálogo (~700 x 550) quedan igual.
const LADO_MAXIMO = 1000;
const CALIDAD = 90;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CARPETA = 'cinta';

/** products/x/foto.png -> products/x/cinta/foto.webp (null si ya es una copia, nueva o vieja) */
function claveMiniatura(key) {
  if (!key || /(^|\/)(mini|cinta)\//.test(key)) return null;
  const barra = key.lastIndexOf('/');
  const carpeta = key.slice(0, barra + 1);
  const archivo = key.slice(barra + 1).replace(/\.[^.]+$/, '');
  return `${carpeta}${CARPETA}/${archivo}.webp`;
}

/** Devuelve la copia WebP de una imagen (Buffer). */
function crearMiniatura(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate() // respeta la orientación de fotos tomadas con el celular
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    // smartSubsample: conserva mejor los bordes de colores (las barras de notas olfativas)
    .webp({ quality: CALIDAD, smartSubsample: true })
    .toBuffer();
}

module.exports = { claveMiniatura, crearMiniatura, CACHE_CONTROL, LADO_MAXIMO };
