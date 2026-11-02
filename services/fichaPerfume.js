// Ficha del perfume: notas, para quién, momento, duración, etc.
// Se guarda en una sola columna JSONB `productos.ficha` (se crea sola la primera vez).
// La tienda solo la muestra cuando está marcada como revisada.
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const PARA = ['mujer', 'hombre', 'unisex'];
const MOMENTO = ['dia', 'noche', 'ambos'];
const DURACION = ['baja', 'media', 'alta'];
const ESTELA = ['suave', 'se_nota', 'fuerte'];
const FAMILIAS = ['citrico', 'fresco', 'floral', 'frutal', 'dulce', 'oriental', 'amaderado', 'especiado', 'acuatico', 'gourmand'];
const TEMPORADAS = ['primavera', 'verano', 'otono', 'invierno'];

let columnaLista = null;
function asegurarColumnaFicha() {
  if (!columnaLista) {
    columnaLista = sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS ficha JSONB`.catch((error) => {
      columnaLista = null;
      throw error;
    });
  }
  return columnaLista;
}

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uno = (v, lista) => (lista.includes(v) ? v : null);
const varios = (v, lista) => Array.from(new Set((Array.isArray(v) ? v : []).filter((x) => lista.includes(x))));
// Notas: lista de textos cortos (acepta arreglo o texto separado por comas)
function notas(v) {
  const lista = Array.isArray(v) ? v : String(v ?? '').split(',');
  return lista.map((n) => texto(n, 40)).filter(Boolean).slice(0, 12);
}

// Limpia lo que llega del panel: solo valores conocidos, textos cortos
function normalizarFicha(body) {
  const b = body || {};
  const n = b.notas || {};
  return {
    inspirado_en: texto(b.inspirado_en, 120) || null,
    notas: { salida: notas(n.salida), corazon: notas(n.corazon), fondo: notas(n.fondo) },
    para: uno(b.para, PARA),
    momento: uno(b.momento, MOMENTO),
    familias: varios(b.familias, FAMILIAS),
    duracion: uno(b.duracion, DURACION),
    estela: uno(b.estela, ESTELA),
    temporadas: varios(b.temporadas, TEMPORADAS),
    revisada: b.revisada === true,
  };
}

async function guardarFicha(productoId, body) {
  await asegurarColumnaFicha();
  const ficha = normalizarFicha(body);
  const filas = await sql`
    UPDATE productos SET ficha = ${JSON.stringify(ficha)}::jsonb
    WHERE id = ${productoId}
    RETURNING id, ficha
  `;
  return filas[0] || null;
}

// Para la tienda: la ficha solo sale si está revisada
function fichaPublica(ficha) {
  return ficha && ficha.revisada === true ? ficha : null;
}

module.exports = { guardarFicha, normalizarFicha, fichaPublica, asegurarColumnaFicha, PARA, MOMENTO, DURACION, ESTELA, FAMILIAS, TEMPORADAS };
