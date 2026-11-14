// Reseñas de Google Maps para la página Comunidad.
// Pide a Google Places API (New) la nota, el total de reseñas, el resumen que
// escribe Gemini y hasta 5 reseñas sueltas (las elige Google). Las reseñas sueltas
// solo llegan si el proyecto de Google tiene facturación activa. Guarda la respuesta en memoria 6 horas para no gastar consultas: Google
// cobra después de 1.000 consultas al mes. No usa la base de datos.
// Sin clave (GOOGLE_PLACES_API_KEY) o si Google falla, devuelve null y la tienda
// muestra la página sin nota ni resumen.

const PLACE_ID = process.env.GOOGLE_PLACE_ID || 'ChIJ2WJPweyZiY4RZst6bom8xx4';
const SEIS_HORAS = 6 * 60 * 60 * 1000;
const MEDIA_HORA = 30 * 60 * 1000; // si Google falla, no reintentar antes de esto

let guardado = null; // { datos, vence }
let enCurso = null;

// Solo enlaces https (vienen de Google, pero van directo a un href en la tienda)
const enlaceSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// Reseñas sueltas con lo que Google exige mostrar: nombre (con enlace al perfil),
// foto, fecha relativa, texto sin cambios y enlace para reportar. Sin texto = se descarta.
function armarResenas(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((r) => {
      const autor = r.authorAttribution || {};
      const texto = String((r.text && r.text.text) || '').trim();
      return {
        autor: String(autor.displayName || '').trim(),
        perfil: enlaceSeguro(autor.uri),
        foto: enlaceSeguro(autor.photoUri),
        estrellas: Number(r.rating) || 0,
        texto,
        hace: String(r.relativePublishTimeDescription || '').trim(),
        enlace: enlaceSeguro(r.googleMapsUri),
        reportar: enlaceSeguro(r.flagContentUri),
      };
    })
    .filter((r) => r.texto && r.autor)
    .slice(0, 5);
}

async function pedirAGoogle(clave) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(PLACE_ID)}?languageCode=es&regionCode=VE`;
  const resp = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': clave,
      'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviewSummary,reviews',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '');
    throw new Error(`Google respondió ${resp.status}: ${detalle.slice(0, 200)}`);
  }
  const lugar = await resp.json();
  const sum = lugar.reviewSummary || {};
  const textoResumen = String((sum.text && sum.text.text) || '').trim();
  return {
    nota: Number(lugar.rating) || null,
    total: Number(lugar.userRatingCount) || 0,
    enlace: lugar.googleMapsUri || null,
    // Google exige mostrar el aviso ("Resumen de Gemini") y el enlace para reportar
    resumen: textoResumen
      ? {
          texto: textoResumen,
          aviso: (sum.disclosureText && sum.disclosureText.text) || 'Resumen de Gemini',
          reportar: sum.flagContentUri || null,
        }
      : null,
    resenas: armarResenas(lugar.reviews),
  };
}

async function obtenerResenasGoogle() {
  const clave = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!clave) return null;
  const ahora = Date.now();
  if (guardado && guardado.vence > ahora) return guardado.datos;
  if (enCurso) return enCurso; // varias visitas a la vez = una sola consulta

  enCurso = pedirAGoogle(clave)
    .then((datos) => {
      guardado = { datos, vence: Date.now() + SEIS_HORAS };
      return datos;
    })
    .catch((error) => {
      console.error('Reseñas de Google:', error.message || error);
      // Si había datos viejos, se siguen mostrando; si no, nada.
      const anteriores = guardado ? guardado.datos : null;
      guardado = { datos: anteriores, vence: Date.now() + MEDIA_HORA };
      return anteriores;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

module.exports = { obtenerResenasGoogle };
