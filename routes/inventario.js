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
  if (!body.producto_id || isNaN(Number(body.producto_id)))
    return res.status(400).json({ error: 'producto_id requerido' });
  if (!body.almacen_id || isNaN(Number(body.almacen_id)))
    return res.status(400).json({ error: 'almacen_id requerido' });
  if (body.cantidad == null || isNaN(Number(body.cantidad)))
    return res.status(400).json({ error: 'cantidad requerida y numérica' });
  const producto_id = Number(body.producto_id);
  const almacen_id = Number(body.almacen_id);
  const cantidad = Number(body.cantidad);
  try {
    // Buscar registro existente
    const rows =
      await sql`SELECT * FROM inventario WHERE producto_id = ${producto_id} AND almacen_id = ${almacen_id}`;
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
      const result =
        await sql`UPDATE inventario SET stock_fisico = ${nuevo} WHERE id = ${inv.id} RETURNING *`;
      return res.json(result[0]);
    } else {
      // No existe registro: solo permitir creación si cantidad >= 0
      if (cantidad < 0)
        return res.status(400).json({ error: 'No existe inventario para reducir en este almacén' });
      const result =
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${producto_id}, ${almacen_id}, ${cantidad}, 0) RETURNING *`;
      return res.status(201).json(result[0]);
    }
  } catch (err) {
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
