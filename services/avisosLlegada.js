// "Avísame cuando llegue": clientes que dejan su teléfono para un perfume agotado.
const { neon } = require('@neondatabase/serverless');
const { getAgotadoProductIds } = require('./productosAgotados');

const sql = neon(process.env.DATABASE_URL);

const ESTADOS = new Set(['esperando', 'avisado', 'descartado']);

let esquemaListo = null;
// Crea la tabla la primera vez que se usa (igual que otras tablas del proyecto)
function asegurarEsquemaAvisos() {
  if (!esquemaListo) {
    esquemaListo = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS avisos_llegada (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          nombre TEXT NOT NULL,
          telefono TEXT NOT NULL,
          estado TEXT NOT NULL DEFAULT 'esperando',
          creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          avisado_en TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_avisos_llegada_estado ON avisos_llegada (estado, producto_id)`;
    })().catch((error) => {
      esquemaListo = null; // se reintenta en la próxima llamada
      throw error;
    });
  }
  return esquemaListo;
}

// Teléfono venezolano a solo dígitos en formato 58XXXXXXXXXX (o null si no es válido)
function normalizarTelefono(valor) {
  let d = String(valor || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = `58${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith('4')) d = `58${d}`;
  if (!/^\d{11,13}$/.test(d)) return null;
  return d;
}

function validarNombre(valor) {
  const nombre = String(valor || '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 2 || nombre.length > 60) return null;
  return nombre;
}

async function crearAviso({ productoId, nombre, telefono }) {
  await asegurarEsquemaAvisos();
  const producto = await sql`
    SELECT id, nombre FROM productos
    WHERE id = ${productoId} AND COALESCE(visible_en_catalogo, TRUE) = TRUE
    LIMIT 1
  `;
  if (!producto.length) return { error: 'Producto no encontrado', status: 404 };

  // Si ya está esperando ese perfume, no se repite
  const existente = await sql`
    SELECT id FROM avisos_llegada
    WHERE producto_id = ${productoId} AND telefono = ${telefono} AND estado = 'esperando'
    LIMIT 1
  `;
  if (existente.length) return { ok: true, ya_registrado: true };

  // Tope de seguridad: un mismo teléfono no puede esperar más de 30 perfumes a la vez
  const cuantos = await sql`SELECT COUNT(*)::int AS n FROM avisos_llegada WHERE telefono = ${telefono} AND estado = 'esperando'`;
  if ((cuantos[0]?.n || 0) >= 30) return { error: 'Ya tienes muchos avisos pendientes', status: 429 };

  await sql`
    INSERT INTO avisos_llegada (producto_id, nombre, telefono)
    VALUES (${productoId}, ${nombre}, ${telefono})
  `;
  return { ok: true, ya_registrado: false };
}

// Lista para el panel: avisos por estado + ranking de perfumes más esperados
async function listarAvisos(estado = 'esperando') {
  await asegurarEsquemaAvisos();
  const estadoFiltro = ESTADOS.has(estado) ? estado : 'esperando';
  const filas = await sql`
    SELECT a.id, a.producto_id, p.nombre AS producto_nombre, p.image_url,
           a.nombre, a.telefono, a.estado, a.creado_en, a.avisado_en
    FROM avisos_llegada a
    JOIN productos p ON p.id = a.producto_id
    WHERE a.estado = ${estadoFiltro}
    ORDER BY a.creado_en DESC
    LIMIT 500
  `;
  const ranking = await sql`
    SELECT a.producto_id, p.nombre AS producto_nombre, COUNT(*)::int AS esperando,
           MIN(a.creado_en) AS desde
    FROM avisos_llegada a
    JOIN productos p ON p.id = a.producto_id
    WHERE a.estado = 'esperando'
    GROUP BY a.producto_id, p.nombre
    ORDER BY esperando DESC, desde ASC
    LIMIT 50
  `;
  const ids = Array.from(new Set([...filas, ...ranking].map((r) => Number(r.producto_id))));
  const agotados = await getAgotadoProductIds(ids, sql);
  const disponible = (id) => !agotados.has(Number(id));
  return {
    avisos: filas.map((r) => ({ ...r, disponible: disponible(r.producto_id) })),
    ranking: ranking.map((r) => ({ ...r, disponible: disponible(r.producto_id) })),
  };
}

async function cambiarEstado(id, estado) {
  await asegurarEsquemaAvisos();
  if (!ESTADOS.has(estado)) return { error: 'Estado inválido', status: 400 };
  const filas = await sql`
    UPDATE avisos_llegada
    SET estado = ${estado},
        avisado_en = CASE WHEN ${estado} = 'avisado' THEN NOW() ELSE NULL END
    WHERE id = ${id}
    RETURNING id, estado, avisado_en
  `;
  if (!filas.length) return { error: 'Aviso no encontrado', status: 404 };
  return { ok: true, aviso: filas[0] };
}

module.exports = { normalizarTelefono, validarNombre, crearAviso, listarAvisos, cambiarEstado };
