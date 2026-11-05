// Enlace propio por perfume: GET /p/:slug  (ej. /p/ch-good-girl-33)
// WhatsApp, Instagram y Facebook leen esta página para armar la vista previa (foto, nombre, precio).
// Las personas son llevadas enseguida a la tienda con ese perfume abierto (/?producto=33).
const { neon } = require('@neondatabase/serverless');
const { getAgotadoProductIds } = require('../services/productosAgotados');
const { fichaPublica } = require('../services/fichaPerfume');

const sql = neon(process.env.DATABASE_URL);
const TIENDA_URL = String(process.env.TIENDA_URL || 'https://www.mirraperfumeria.com').replace(/\/$/, '');

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "56. CH GOOD GIRL" -> "CH Good Girl"
function nombreBonito(nombre) {
  const limpio = String(nombre || '').replace(/^\s*\d+\.\s*/, '').trim().toLowerCase();
  return limpio
    .split(' ')
    // Siglas con puntos (V.S) o cortas conocidas (CH, YSL...) en mayúsculas; el resto con inicial mayúscula
    .map((w) => (/\./.test(w) || /^(ch|vs|ysl|dg|cr|jpg|ck)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
const tamanoDe = (nombreFormula) => {
  const m = String(nombreFormula || '').match(/(\d+(?:[.,]\d+)?)\s*ml/i);
  return m ? Number(m[1].replace(',', '.')) : null;
};

async function paginaCompartir(req, res) {
  const id = Number((String(req.params.slug || '').match(/(\d+)$/) || [])[1]);
  const tiendaProducto = Number.isInteger(id) && id > 0 ? `${TIENDA_URL}/?producto=${id}` : TIENDA_URL;
  try {
    if (!Number.isInteger(id) || id <= 0) return res.redirect(302, TIENDA_URL);
    const filas = await sql`
      SELECT p.*,
        (SELECT json_agg(json_build_object('nombre', f.nombre, 'precio', f.precio_venta) ORDER BY f.precio_venta)
           FROM formulas f WHERE f.producto_terminado_id = p.id AND f.activo = TRUE) AS presentaciones
      FROM productos p
      WHERE p.id = ${id} AND COALESCE(p.visible_en_catalogo, TRUE) = TRUE
      LIMIT 1
    `;
    if (!filas.length) return res.redirect(302, TIENDA_URL);
    const p = filas[0];
    const agotado = (await getAgotadoProductIds([id], sql)).has(id);
    const ficha = fichaPublica(p.ficha);
    const pres = (p.presentaciones || []).filter((x) => x && x.precio != null);
    const precios = pres.map((x) => Number(x.precio)).filter((n) => Number.isFinite(n) && n > 0);
    const tamanos = Array.from(new Set(pres.map((x) => tamanoDe(x.nombre)).filter(Boolean))).sort((a, b) => a - b);

    const nombre = nombreBonito(p.nombre);
    const titulo = `${nombre} · Mirra Perfumería`;
    const partes = [];
    if (ficha?.inspirado_en) partes.push(`Inspirado en ${ficha.inspirado_en}.`);
    if (agotado) partes.push('Agotado por el momento: déjanos tu WhatsApp y te avisamos cuando llegue.');
    else {
      if (precios.length) partes.push(`Desde $${Math.min(...precios).toFixed(2).replace(/\.00$/, '')}`);
      if (tamanos.length) partes.push(`${tamanos.join(', ').replace(/, (\d+)$/, ' y $1')} ml.`);
    }
    const descripcion = partes.join(' · ').replace(' · Agotado', ' Agotado') || 'Perfumes inspirados en las grandes fragancias.';
    const imagen = /^https?:\/\//i.test(p.image_url || '') ? p.image_url : `${TIENDA_URL}/logo.png`;
    const enlace = `${TIENDA_URL}/p/${escapar(req.params.slug)}`;

    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descripcion)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Mirra Perfumería">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(descripcion)}">
<meta property="og:image" content="${escapar(imagen)}">
<meta property="og:url" content="${enlace}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${escapar(tiendaProducto)}">
<script>location.replace(${JSON.stringify(tiendaProducto)});</script>
</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:40px 16px">
<p>Abriendo <a href="${escapar(tiendaProducto)}">${escapar(nombre)} en Mirra Perfumería</a>…</p>
</body></html>`);
  } catch (error) {
    console.error('[compartir] Error armando la vista previa:', error && error.message ? error.message : error);
    return res.redirect(302, tiendaProducto);
  }
}

module.exports = { paginaCompartir, nombreBonito };
