// Costos por presentación (camino "por tamaño"): un costo para cada tamaño (30 ml, 60 ml, 100 ml...)
// que vale para todos los perfumes de ese tamaño, y costos especiales para algún perfume en particular.
// Los usan los reportes para calcular la ganancia, también la de ventas pasadas (siempre el costo actual).
//
// Tabla costos_presentacion: (ml, producto_id) -> costo. producto_id = 0 es el costo general del tamaño.

const { neon } = require('@neondatabase/serverless');

// Conexión perezosa (se crea al primer uso, cuando ya existe DATABASE_URL)
let sqlInterno = null;
function sql(...args) {
  if (!sqlInterno) sqlInterno = neon(process.env.DATABASE_URL);
  return sqlInterno(...args);
}
sql.query = (...args) => {
  if (!sqlInterno) sqlInterno = neon(process.env.DATABASE_URL);
  return sqlInterno.query(...args);
};

const COSTO_MAXIMO = 10000;
const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

let tablaLista = null;
function asegurarTablaCostos(db = sql) {
  if (!tablaLista) {
    tablaLista = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS costos_presentacion (
          ml NUMERIC(8, 2) NOT NULL,
          producto_id INT NOT NULL DEFAULT 0,
          costo NUMERIC(12, 2) NOT NULL,
          actualizado_en TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'America/Caracas'),
          PRIMARY KEY (ml, producto_id)
        )`;
    })().catch((err) => { tablaLista = null; throw err; });
  }
  return tablaLista;
}

// "LATTAFA ASAD Presentación 100 ml" -> 100 (misma regla que el resto de reportes)
const ML_SQL = `NULLIF(REPLACE(SUBSTRING(LOWER(f.nombre) FROM '([0-9]+(?:[.,][0-9]+)?)\\s*ml'), ',', '.'), '')::numeric`;

/** Tamaños que existen (según las presentaciones), sus costos y los costos especiales por perfume. */
async function obtenerCostos() {
  await asegurarTablaCostos();
  const [tamanos, especiales, perfumes] = await Promise.all([
    sql.query(`
      WITH tam AS (
        SELECT ${ML_SQL} AS ml, COUNT(*)::int AS presentaciones
        FROM formulas f GROUP BY 1
      )
      SELECT t.ml, t.presentaciones, c.costo
      FROM tam t
      LEFT JOIN costos_presentacion c ON c.ml = t.ml AND c.producto_id = 0
      WHERE t.ml IS NOT NULL
      ORDER BY t.ml`),
    sql`
      SELECT c.ml, c.producto_id, c.costo, p.nombre
      FROM costos_presentacion c
      LEFT JOIN productos p ON p.id = c.producto_id
      WHERE c.producto_id <> 0
      ORDER BY p.nombre, c.ml`,
    sql.query(`
      SELECT p.id AS producto_id, p.nombre,
             ARRAY_AGG(DISTINCT ${ML_SQL} ORDER BY ${ML_SQL}) FILTER (WHERE ${ML_SQL} IS NOT NULL) AS tamanos
      FROM formulas f JOIN productos p ON p.id = f.producto_terminado_id
      GROUP BY p.id, p.nombre
      ORDER BY p.nombre`),
  ]);
  return {
    tamanos: tamanos.map((t) => ({ ml: Number(t.ml), presentaciones: Number(t.presentaciones), costo: t.costo == null ? null : Number(t.costo) })),
    especiales: especiales.map((e) => ({ ml: Number(e.ml), producto_id: Number(e.producto_id), nombre: e.nombre || `Producto #${e.producto_id}`, costo: Number(e.costo) })),
    perfumes: perfumes.map((p) => ({ producto_id: Number(p.producto_id), nombre: p.nombre, tamanos: (p.tamanos || []).map(Number) })),
  };
}

/** Valida lo que llega del panel. Costo vacío = quitar ese costo. */
function normalizarCostos(entrada) {
  const e = entrada || {};
  const filas = [];
  const leer = (lista, conProducto) => {
    if (lista == null) return null;
    if (!Array.isArray(lista)) return 'Formato inválido';
    for (const x of lista) {
      const ml = Number(x?.ml);
      if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) return 'Tamaño (ml) inválido';
      const productoId = conProducto ? Number(x?.producto_id) : 0;
      if (conProducto && (!Number.isInteger(productoId) || productoId <= 0)) return 'Perfume inválido';
      const vacio = x?.costo === null || x?.costo === undefined || x?.costo === '';
      const costo = vacio ? null : Number(String(x.costo).replace(',', '.'));
      if (!vacio && (!Number.isFinite(costo) || costo < 0 || costo > COSTO_MAXIMO)) return `El costo de ${ml} ml no es válido`;
      filas.push({ ml, producto_id: productoId, costo: costo == null ? null : redondear(costo) });
    }
    return null;
  };
  const err = leer(e.tamanos, false) || leer(e.especiales, true);
  if (err) return { error: err };
  return { filas, reemplazarEspeciales: Array.isArray(e.especiales) };
}

/** Guarda los costos. Si llega la lista de especiales, reemplaza la anterior (los que no vienen se quitan). */
async function guardarCostos(entrada) {
  const n = normalizarCostos(entrada);
  if (n.error) return n;
  await asegurarTablaCostos();
  if (n.reemplazarEspeciales) await sql`DELETE FROM costos_presentacion WHERE producto_id <> 0`;
  for (const f of n.filas) {
    if (f.costo == null) {
      await sql`DELETE FROM costos_presentacion WHERE ml = ${f.ml} AND producto_id = ${f.producto_id}`;
    } else {
      await sql`
        INSERT INTO costos_presentacion (ml, producto_id, costo, actualizado_en)
        VALUES (${f.ml}, ${f.producto_id}, ${f.costo}, NOW() AT TIME ZONE 'America/Caracas')
        ON CONFLICT (ml, producto_id) DO UPDATE SET costo = EXCLUDED.costo, actualizado_en = EXCLUDED.actualizado_en`;
    }
  }
  return { ok: true, costos: await obtenerCostos() };
}

module.exports = { asegurarTablaCostos, obtenerCostos, guardarCostos, normalizarCostos };
