const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarInventario(body) {
  if (!body.producto_id || isNaN(Number(body.producto_id))) return 'ID de producto requerido';
  if (!body.almacen_id || isNaN(Number(body.almacen_id))) return 'ID de almacén requerido';
  if (body.stock_fisico == null || isNaN(Number(body.stock_fisico)))
    return 'Stock físico requerido';
  if (body.stock_comprometido == null || isNaN(Number(body.stock_comprometido)))
    return 'Stock comprometido requerido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const result =
      await sql`SELECT *, stock_fisico - stock_comprometido AS stock_disponible FROM inventario`;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarInventario(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { producto_id, almacen_id, stock_fisico, stock_comprometido } = req.body;
    const result = await sql`
      INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido)
      VALUES (${producto_id}, ${almacen_id}, ${stock_fisico}, ${stock_comprometido}) RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajustar existencia por almacén (incrementar o decrementar stock_fisico)
// Body: { producto_id, almacen_id, cantidad }
router.post('/ajustar', async (req, res) => {
  const body = req.body || {};

  console.log('--- PETICIÓN DE AJUSTE DE INVENTARIO ---');
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log('----------------------------------------');

  if (!body.producto_id || isNaN(Number(body.producto_id)))
    return res.status(400).json({ error: 'producto_id requerido' });
  if (!body.almacen_id || isNaN(Number(body.almacen_id)))
    return res.status(400).json({ error: 'almacen_id requerido' });
  if (body.cantidad == null || isNaN(Number(body.cantidad)))
    return res.status(400).json({ error: 'cantidad requerida y numérica' });
  const producto_id = Number(body.producto_id);
  const almacen_id = Number(body.almacen_id);
  const cantidad = Number(body.cantidad);
  const motivo = body.motivo ? String(body.motivo).trim() : (cantidad >= 0 ? 'Ajuste de entrada' : 'Ajuste de salida');
  try {
    // Buscar registro existente
    const rows =
      await sql`SELECT * FROM inventario WHERE producto_id = ${producto_id} AND almacen_id = ${almacen_id}`;
    let result;
    if (rows && rows.length > 0) {
      const inv = rows[0];
      const stockFisico = Number(inv.stock_fisico || 0);
      const stockComprometido = Number(inv.stock_comprometido || 0);
      const nuevo = stockFisico + cantidad;
      if (nuevo < 0)
        return res.status(400).json({ error: 'No se puede reducir stock por debajo de 0' });
      if (nuevo < stockComprometido)
        return res
          .status(400)
          .json({ error: 'No se puede reducir stock por debajo del stock comprometido' });
      const updated =
        await sql`UPDATE inventario SET stock_fisico = ${nuevo} WHERE id = ${inv.id} RETURNING *`;
      result = updated[0];
    } else {
      // No existe registro: solo permitir creación si cantidad >= 0
      if (cantidad < 0)
        return res.status(400).json({ error: 'No existe inventario para reducir en este almacén' });
      const created =
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${producto_id}, ${almacen_id}, ${cantidad}, 0) RETURNING *`;
      result = created[0];
    }

    // Registrar en historial de movimientos
    const tipo = cantidad >= 0 ? 'entrada' : 'salida';
    const cantAbs = Math.abs(cantidad);
    await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${producto_id}, ${almacen_id}, ${tipo}, ${cantAbs}, ${motivo})`;

    return rows && rows.length > 0 ? res.json(result) : res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventario/movimientos
// Lista el historial de movimientos de inventario (kardex).
// Filtros opcionales: ?producto_id=X, ?tipo=entrada|salida, ?limit=N (default 200)
router.get('/movimientos', async (req, res) => {
  try {
    const { producto_id, tipo, limit } = req.query;
    const maxRows = Math.min(Number(limit) || 200, 1000);
    let result;
    if (producto_id && !isNaN(Number(producto_id)) && tipo) {
      result = await sql`
        SELECT m.*, p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.producto_id = ${Number(producto_id)} AND m.tipo = ${tipo}
        ORDER BY m.id DESC
        LIMIT ${maxRows}
      `;
    } else if (producto_id && !isNaN(Number(producto_id))) {
      result = await sql`
        SELECT m.*, p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.producto_id = ${Number(producto_id)}
        ORDER BY m.id DESC
        LIMIT ${maxRows}
      `;
    } else if (tipo) {
      result = await sql`
        SELECT m.*, p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.tipo = ${tipo}
        ORDER BY m.id DESC
        LIMIT ${maxRows}
      `;
    } else {
      result = await sql`
        SELECT m.*, p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        ORDER BY m.id DESC
        LIMIT ${maxRows}
      `;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventario/entradas-esencias
// Historial de entradas de inventario para materias primas (esencias ESC. INSP.)
// Filtros opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&producto_id=X&limit=N
router.get('/entradas-esencias', async (req, res) => {
  try {
    const { desde, hasta, producto_id, limit } = req.query;
    const maxRows = Math.min(Number(limit) || 500, 2000);

    // IDs de materias primas: productos que aparecen en formula_componentes como materia_prima_id
    const esenciasRows = await sql`
      SELECT DISTINCT fc.materia_prima_id AS id, COALESCE(p.nombre, i.nombre) AS nombre
      FROM formula_componentes fc
      LEFT JOIN productos p ON p.id = fc.materia_prima_id
      LEFT JOIN ingredientes i ON i.id = fc.materia_prima_id
      WHERE fc.materia_prima_id IS NOT NULL
    `;
    if (esenciasRows.length === 0) return res.json([]);

    const esenciaIds = esenciasRows.map((r) => Number(r.id));
    const esenciaMap = Object.fromEntries(esenciasRows.map((r) => [String(r.id), r.nombre]));

    let rows;
    const desdeDate = desde ? new Date(desde) : null;
    const hastaDate = hasta ? new Date(hasta + 'T23:59:59') : null;

    if (producto_id && !isNaN(Number(producto_id)) && desdeDate && hastaDate) {
      rows = await sql`
        SELECT m.id, m.producto_id, m.almacen_id, m.cantidad, m.motivo, m.referencia, m.creado_en,
               p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.tipo = 'entrada'
          AND m.producto_id = ${Number(producto_id)}
          AND m.producto_id = ANY(${esenciaIds})
          AND (m.motivo IS NULL OR (m.motivo NOT ILIKE '%devolución%' AND m.motivo NOT ILIKE '%cancelaci%'))
          AND m.creado_en >= ${desdeDate.toISOString()}
          AND m.creado_en <= ${hastaDate.toISOString()}
        ORDER BY m.creado_en DESC
        LIMIT ${maxRows}
      `;
    } else if (producto_id && !isNaN(Number(producto_id))) {
      rows = await sql`
        SELECT m.id, m.producto_id, m.almacen_id, m.cantidad, m.motivo, m.referencia, m.creado_en,
               p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.tipo = 'entrada'
          AND m.producto_id = ${Number(producto_id)}
          AND m.producto_id = ANY(${esenciaIds})
          AND (m.motivo IS NULL OR (m.motivo NOT ILIKE '%devolución%' AND m.motivo NOT ILIKE '%cancelaci%'))
        ORDER BY m.creado_en DESC
        LIMIT ${maxRows}
      `;
    } else if (desdeDate && hastaDate) {
      rows = await sql`
        SELECT m.id, m.producto_id, m.almacen_id, m.cantidad, m.motivo, m.referencia, m.creado_en,
               p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.tipo = 'entrada'
          AND m.producto_id = ANY(${esenciaIds})
          AND (m.motivo IS NULL OR (m.motivo NOT ILIKE '%devolución%' AND m.motivo NOT ILIKE '%cancelaci%'))
          AND m.creado_en >= ${desdeDate.toISOString()}
          AND m.creado_en <= ${hastaDate.toISOString()}
        ORDER BY m.creado_en DESC
        LIMIT ${maxRows}
      `;
    } else {
      rows = await sql`
        SELECT m.id, m.producto_id, m.almacen_id, m.cantidad, m.motivo, m.referencia, m.creado_en,
               p.nombre AS producto_nombre, a.nombre AS almacen_nombre
        FROM inventario_movimientos m
        LEFT JOIN productos p ON p.id = m.producto_id
        LEFT JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.tipo = 'entrada'
          AND m.producto_id = ANY(${esenciaIds})
          AND (m.motivo IS NULL OR (m.motivo NOT ILIKE '%devolución%' AND m.motivo NOT ILIKE '%cancelaci%'))
        ORDER BY m.creado_en DESC
        LIMIT ${maxRows}
      `;
    }

    const result = rows.map((r) => ({
      id: r.id,
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre || esenciaMap[String(r.producto_id)] || `Esencia #${r.producto_id}`,
      almacen_id: r.almacen_id,
      almacen_nombre: r.almacen_nombre || null,
      cantidad: Number(r.cantidad),
      motivo: r.motivo || null,
      referencia: r.referencia || null,
      creado_en: r.creado_en,
    }));

    res.json(result);
  } catch (err) {
    console.error('entradas-esencias error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result =
      await sql`SELECT *, stock_fisico - stock_comprometido AS stock_disponible FROM inventario WHERE id = ${req.params.id}`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
