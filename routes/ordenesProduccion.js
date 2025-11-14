const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarOrden(body) {
  if (!body.producto_terminado_id || isNaN(Number(body.producto_terminado_id))) return 'ID de producto terminado requerido';
  if (!body.cantidad || isNaN(Number(body.cantidad))) return 'Cantidad requerida';
  if (!body.formula_id || isNaN(Number(body.formula_id))) return 'ID de fórmula requerido';
  if (!body.estado || !['Pendiente', 'Completada'].includes(body.estado)) return 'Estado inválido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const result = await sql`SELECT * FROM ordenes_produccion`;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarOrden(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { producto_terminado_id, cantidad, formula_id, estado } = req.body;
    const result = await sql`
      INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha)
      VALUES (${producto_terminado_id}, ${cantidad}, ${formula_id}, ${estado}, NOW()) RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Completar una orden de producción: consumir materia prima y guardar producto terminado en almacén destino
// POST /api/ordenes-produccion/:id/completar
// Body: { almacen_venta_id }
router.post('/:id/completar', async (req, res) => {
  const ordenId = Number(req.params.id);
  const { almacen_venta_id } = req.body || {};
  if (isNaN(ordenId)) return res.status(400).json({ error: 'ID inválido' });
  if (!almacen_venta_id || isNaN(Number(almacen_venta_id))) return res.status(400).json({ error: 'almacen_venta_id requerido e inválido' });
  try {
    await sql`BEGIN`;
    const orden = await sql`SELECT * FROM ordenes_produccion WHERE id = ${ordenId} FOR UPDATE`;
    if (!orden || orden.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const ord = orden[0];
    if (ord.estado === 'Completada') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'Orden ya está completada' });
    }

    // Verificar almacén destino: no debe estar marcado como materia prima
    const dest = await sql`SELECT * FROM almacenes WHERE id = ${almacen_venta_id} FOR NO KEY UPDATE`;
    if (!dest || dest.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Almacén destino no encontrado' });
    }
    if (dest[0].es_materia_prima === true) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'El almacén destino no puede ser marcado como materia prima' });
    }

    // Obtener componentes de la fórmula
    const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${ord.formula_id}`;
    if (!componentes || componentes.length === 0) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'Fórmula sin componentes' });
    }

    const qty = Number(ord.cantidad);
    const movimientos = [];

    // Verificar disponibilidad y consumir materia prima desde almacenes marcados como materia prima
    for (const comp of componentes) {
      let required = Number(comp.cantidad) * qty;
      const mpInventarios = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${comp.materia_prima_id} AND a.es_materia_prima = true
        ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        FOR UPDATE
      `;
      let totalAvailable = 0;
      for (const inv of mpInventarios) totalAvailable += Number(inv.stock_fisico) - Number(inv.stock_comprometido);
      if (totalAvailable < required) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: `Materia prima ${comp.materia_prima_id} insuficiente` });
      }
      for (const inv of mpInventarios) {
        if (required <= 0) break;
        const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
        if (available <= 0) continue;
        const take = Math.min(available, required);
        const consumed = await sql`
          UPDATE inventario
          SET stock_fisico = stock_fisico - ${take}, stock_comprometido = GREATEST(0, stock_comprometido - ${take})
          WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0
          RETURNING id, stock_fisico, stock_comprometido
        `;
        if (!consumed || consumed.length === 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: `Inventario insuficiente al consumir materia prima id ${comp.materia_prima_id}` });
        }
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${comp.materia_prima_id}, ${inv.almacen_id}, 'salida', ${take}, ${'Producción orden ' + ordenId})`;
        movimientos.push({ materia_prima_id: comp.materia_prima_id, almacen_id: inv.almacen_id, cantidad: take });
        required -= take;
      }
    }

    // Incrementar inventario del producto terminado en almacen destino
    const prodId = ord.producto_terminado_id;
    const existing = await sql`SELECT * FROM inventario WHERE producto_id = ${prodId} AND almacen_id = ${almacen_venta_id} FOR UPDATE`;
    let destinoInv;
    if (existing && existing.length > 0) {
      const up = await sql`UPDATE inventario SET stock_fisico = stock_fisico + ${qty} WHERE id = ${existing[0].id} RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = up[0];
    } else {
      const created = await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${prodId}, ${almacen_venta_id}, ${qty}, 0) RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = created[0];
    }
    await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${prodId}, ${almacen_venta_id}, 'entrada', ${qty}, ${'Producción orden ' + ordenId})`;

    await sql`UPDATE ordenes_produccion SET estado = 'Completada' WHERE id = ${ordenId}`;

    await sql`COMMIT`;
    return res.json({ success: true, orden: { ...ord, estado: 'Completada' }, movimientos, inventario_destino: { ...destinoInv, stock_disponible: Number(destinoInv.stock_fisico) - Number(destinoInv.stock_comprometido) } });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await sql`SELECT * FROM ordenes_produccion WHERE id = ${req.params.id}`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
