const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Validación básica
function validarProducto(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  if (!body.tipo || !['MateriaPrima', 'ProductoTerminado'].includes(body.tipo)) return 'Tipo inválido';
  if (!body.unidad || typeof body.unidad !== 'string') return 'Unidad requerida';
  if (body.stock != null && isNaN(Number(body.stock))) return 'Stock debe ser numérico';
  if (body.image_url != null && typeof body.image_url !== 'string') return 'image_url debe ser string';
  return null;
}

// Obtener todos los productos
router.get('/', async (req, res) => {
  try {
    // Traer productos junto con inventario agregado por producto (una sola consulta)
    const rows = await sql`
      SELECT p.*, 
        COALESCE(inv_tot.stock_disponible_total, 0) AS stock,
        COALESCE(inv_arr.inventario, '[]'::json) AS inventario
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, json_agg(json_build_object(
          'id', i.id,
          'almacen_id', i.almacen_id,
          'almacen_nombre', a.nombre,
          'almacen_tipo', a.tipo,
          'almacen_ubicacion', a.ubicacion,
          'stock_fisico', i.stock_fisico,
          'stock_comprometido', i.stock_comprometido,
          'stock_disponible', (i.stock_fisico - i.stock_comprometido)
        ) ORDER BY (i.stock_fisico - i.stock_comprometido) DESC) AS inventario
        FROM inventario i
        LEFT JOIN almacenes a ON a.id = i.almacen_id
        GROUP BY producto_id
      ) inv_arr ON inv_arr.producto_id = p.id
      LEFT JOIN (
        SELECT producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS stock_disponible_total
        FROM inventario i
        GROUP BY producto_id
      ) inv_tot ON inv_tot.producto_id = p.id
    `;
    // Normalizar tipos numéricos en JS
    const productos = (rows || []).map(p => {
      const inventario = (p.inventario && Array.isArray(p.inventario)) ? p.inventario.map(i => ({
        id: i.id,
        almacen_id: i.almacen_id,
        almacen_nombre: i.almacen_nombre,
        almacen_tipo: i.almacen_tipo,
        almacen_ubicacion: i.almacen_ubicacion,
        stock_fisico: Number(i.stock_fisico),
        stock_comprometido: Number(i.stock_comprometido),
        stock_disponible: Number(i.stock_disponible)
      })) : [];
      return { ...p, stock: Number(p.stock), inventario };
    });
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear producto
router.post('/', async (req, res) => {
  // Normalizar alias en español/inglés: aceptar `imagen_url` o `image_url`
  const payloadPost = { ...req.body, image_url: req.body.image_url ?? req.body.imagen_url };
  const error = validarProducto(payloadPost);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url } = payloadPost;
    const result = await sql`
      INSERT INTO productos (nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url)
      VALUES (${nombre}, ${tipo}, ${unidad}, ${stock || 0}, ${costo || 0}, ${precio_venta || 0}, ${proveedor_id || null}, ${image_url || null})
      RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener producto por id
router.get('/:id', async (req, res) => {
  try {
    const rows = await sql`
      SELECT p.*, 
        COALESCE(inv_tot.stock_disponible_total, 0) AS stock,
        COALESCE(inv_arr.inventario, '[]'::json) AS inventario
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, json_agg(json_build_object(
          'id', i.id,
          'almacen_id', i.almacen_id,
          'almacen_nombre', a.nombre,
          'almacen_tipo', a.tipo,
          'almacen_ubicacion', a.ubicacion,
          'stock_fisico', i.stock_fisico,
          'stock_comprometido', i.stock_comprometido,
          'stock_disponible', (i.stock_fisico - i.stock_comprometido)
        ) ORDER BY (i.stock_fisico - i.stock_comprometido) DESC) AS inventario
        FROM inventario i
        LEFT JOIN almacenes a ON a.id = i.almacen_id
        GROUP BY producto_id
      ) inv_arr ON inv_arr.producto_id = p.id
      LEFT JOIN (
        SELECT producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS stock_disponible_total
        FROM inventario i
        GROUP BY producto_id
      ) inv_tot ON inv_tot.producto_id = p.id
      WHERE p.id = ${req.params.id}
    `;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const p = rows[0];
    const inventario = (p.inventario && Array.isArray(p.inventario)) ? p.inventario.map(i => ({
      id: i.id,
      almacen_id: i.almacen_id,
      almacen_nombre: i.almacen_nombre,
      almacen_tipo: i.almacen_tipo,
      almacen_ubicacion: i.almacen_ubicacion,
      stock_fisico: Number(i.stock_fisico),
      stock_comprometido: Number(i.stock_comprometido),
      stock_disponible: Number(i.stock_disponible)
    })) : [];
    res.json({ ...p, stock: Number(p.stock), inventario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar producto
router.put('/:id', async (req, res) => {
  const error = validarProducto(req.body);
  if (error) return res.status(400).json({ error });
  try {
    // Normalizar alias en español/inglés: aceptar `imagen_url` o `image_url`
    const payloadPut = { ...req.body, image_url: req.body.image_url ?? req.body.imagen_url };
    const { nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url } = payloadPut;
    // Evitar sobrescribir image_url con NULL cuando el cliente no envía ese campo.
    // COALESCE(${image_url}, image_url) usará el valor enviado o mantendrá el existente.
    const result = await sql`
      UPDATE productos SET nombre=${nombre}, tipo=${tipo}, unidad=${unidad}, stock=${stock}, costo=${costo}, precio_venta=${precio_venta}, proveedor_id=${proveedor_id}, image_url=COALESCE(${image_url}, image_url)
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar producto
router.delete('/:id', async (req, res) => {
  try {
    const result = await sql`DELETE FROM productos WHERE id = ${req.params.id} RETURNING *`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, producto: result[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
