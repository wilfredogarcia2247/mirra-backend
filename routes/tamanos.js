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
    // Compatibilidad: la tabla `tamanos` fue eliminada; tratamos `formulas` como los tamaños asociados a un producto terminado
    let rows;
    if (productoId) {
      rows = await sql`SELECT f.id, f.producto_terminado_id AS producto_id, f.nombre, f.costo, f.precio_venta FROM formulas f WHERE f.producto_terminado_id = ${productoId} ORDER BY f.nombre`;
    } else {
      rows = await sql`SELECT f.id, f.producto_terminado_id AS producto_id, f.nombre, f.costo, f.precio_venta FROM formulas f ORDER BY f.producto_terminado_id, f.nombre`;
    }
    const tamanos = (rows || []).map(t => ({ id: t.id, producto_id: t.producto_id, nombre: t.nombre, cantidad: t.cantidad != null ? Number(t.cantidad) : null, unidad: t.unidad || null, costo: t.costo != null ? Number(t.costo) : null, precio_venta: t.precio_venta != null ? Number(t.precio_venta) : null }));
    res.json(tamanos);
  } catch (err) {
    console.error('Error GET /api/tamanos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tamanos/:id
router.get('/:id', async (req, res) => {
  try {
    // Devolver fórmula correspondiente como tamaño
    const rows = await sql`SELECT f.id, f.producto_terminado_id AS producto_id, f.nombre, f.costo, f.precio_venta, f.cantidad, f.unidad FROM formulas f WHERE f.id = ${req.params.id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const t = rows[0];
    res.json({ id: t.id, producto_id: t.producto_id, nombre: t.nombre, cantidad: t.cantidad != null ? Number(t.cantidad) : null, unidad: t.unidad || null, costo: t.costo != null ? Number(t.costo) : null, precio_venta: t.precio_venta != null ? Number(t.precio_venta) : null });
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
    // Crear una fórmula que represente este tamaño (compatibilidad)
    const { nombre, cantidad, unidad, producto_id, costo, precio_venta } = req.body;
    const prod = await sql`SELECT id FROM productos WHERE id = ${producto_id}`;
    if (!prod || prod.length === 0) return res.status(400).json({ error: 'producto_id no existe' });
    const created = await sql`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${producto_id}, ${nombre}, ${costo || null}, ${precio_venta || null}) RETURNING *`;
    res.status(201).json({ id: created[0].id, producto_id, nombre: created[0].nombre, costo: created[0].costo, precio_venta: created[0].precio_venta });
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
    // Actualizar la fórmula asociada (compatibilidad)
    const { nombre, cantidad, unidad, producto_id, costo, precio_venta } = req.body;
    if (producto_id != null) {
      const prod = await sql`SELECT id FROM productos WHERE id = ${producto_id}`;
      if (!prod || prod.length === 0) return res.status(400).json({ error: 'producto_id no existe' });
    }
    const result = await sql`UPDATE formulas SET nombre = ${nombre}, costo = ${costo}, precio_venta = ${precio_venta} WHERE id = ${req.params.id} RETURNING *`;
    if (!result || result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ id: result[0].id, producto_id: result[0].producto_terminado_id, nombre: result[0].nombre, costo: result[0].costo, precio_venta: result[0].precio_venta });
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
    // Como `tamanos` fue eliminado, borramos la fórmula que representa este tamaño si no tiene ordenes de producción
    const ops = await sql`SELECT COUNT(*)::int AS c FROM ordenes_produccion WHERE formula_id = ${id}`;
    if (ops && ops[0] && Number(ops[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar: existen órdenes de producción asociadas' });
    const del = await sql`DELETE FROM formulas WHERE id = ${id} RETURNING *`;
    if (!del || del.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, tamanos: { id: del[0].id, nombre: del[0].nombre, producto_id: del[0].producto_terminado_id } });
  } catch (err) {
    console.error('Error eliminando tamaño:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
