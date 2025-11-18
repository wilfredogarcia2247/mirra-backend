const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarTamano(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'nombre requerido';
  if (body.cantidad != null && isNaN(Number(body.cantidad))) return 'cantidad inválida';
  if (body.producto_id == null || isNaN(Number(body.producto_id))) return 'producto_id requerido e inválido';
  if (body.unidad != null && typeof body.unidad !== 'string') return 'unidad inválida';
  if (body.costo != null && isNaN(Number(body.costo))) return 'costo inválido';
  if (body.precio_venta != null && isNaN(Number(body.precio_venta))) return 'precio_venta inválido';
  return null;
}

// GET /api/tamanos?producto_id=123
router.get('/', async (req, res) => {
  try {
    const productoId = req.query.producto_id ? Number(req.query.producto_id) : null;
    let rows;
    if (productoId) {
      rows = await sql`SELECT * FROM tamanos WHERE producto_id = ${productoId} ORDER BY nombre`;
    } else {
      rows = await sql`SELECT * FROM tamanos ORDER BY producto_id, nombre`;
    }
    const tamanos = (rows || []).map(t => ({ ...t, cantidad: t.cantidad != null ? Number(t.cantidad) : null, costo: t.costo != null ? Number(t.costo) : null, precio_venta: t.precio_venta != null ? Number(t.precio_venta) : null, factor_multiplicador_venta: t.factor_multiplicador_venta != null ? Number(t.factor_multiplicador_venta) : null }));
    res.json(tamanos);
  } catch (err) {
    console.error('Error GET /api/tamanos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tamanos/:id
router.get('/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM tamanos WHERE id = ${req.params.id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const t = rows[0];
    res.json({ ...t, cantidad: t.cantidad != null ? Number(t.cantidad) : null, costo: t.costo != null ? Number(t.costo) : null, precio_venta: t.precio_venta != null ? Number(t.precio_venta) : null, factor_multiplicador_venta: t.factor_multiplicador_venta != null ? Number(t.factor_multiplicador_venta) : null });
  } catch (err) {
    console.error('Error GET /api/tamanos/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tamanos
router.post('/', async (req, res) => {
  const error = validarTamano(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta } = req.body;
    // Verificar producto
    const prod = await sql`SELECT id FROM productos WHERE id = ${producto_id}`;
    if (!prod || prod.length === 0) return res.status(400).json({ error: 'producto_id no existe' });
    const created = await sql`
      INSERT INTO tamanos (nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta)
      VALUES (${nombre}, ${cantidad || null}, ${unidad || null}, ${producto_id}, ${costo || null}, ${precio_venta || null}, ${factor_multiplicador_venta || null})
      RETURNING *
    `;
    res.status(201).json(created[0]);
  } catch (err) {
    console.error('Error creando tamaño:', err);
    // Manejo simple de violación de unicidad por producto+nombre
    if (err && err.code === '23505') return res.status(400).json({ error: 'Ya existe un tamaño con ese nombre para este producto' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tamanos/:id
router.put('/:id', async (req, res) => {
  const error = validarTamano({ ...req.body, producto_id: req.body.producto_id ?? req.body.producto });
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta } = req.body;
    if (producto_id != null) {
      const prod = await sql`SELECT id FROM productos WHERE id = ${producto_id}`;
      if (!prod || prod.length === 0) return res.status(400).json({ error: 'producto_id no existe' });
    }
    const result = await sql`
      UPDATE tamanos SET nombre=${nombre}, cantidad=${cantidad}, unidad=${unidad}, producto_id=${producto_id}, costo=${costo}, precio_venta=${precio_venta}, factor_multiplicador_venta=${factor_multiplicador_venta}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!result || result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    console.error('Error actualizando tamaño:', err);
    if (err && err.code === '23505') return res.status(400).json({ error: 'Ya existe un tamaño con ese nombre para este producto' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tamanos/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    // Verificar referencias en formulas y precio_productos
    const f = await sql`SELECT COUNT(*)::int AS c FROM formulas WHERE tamano_id = ${id}`;
    if (f && f[0] && Number(f[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar: tamaño referenciado en formulas' });
    const p = await sql`SELECT COUNT(*)::int AS c FROM precio_productos WHERE tamano_id = ${id}`;
    if (p && p[0] && Number(p[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar: existe precio calculado para este tamaño' });

    const del = await sql`DELETE FROM tamanos WHERE id = ${id} RETURNING *`;
    if (!del || del.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, tamanos: del[0] });
  } catch (err) {
    console.error('Error eliminando tamaño:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
