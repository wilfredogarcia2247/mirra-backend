const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Validación básica
function validarProducto(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  if (!body.tipo || !['interno', 'ProductoTerminado'].includes(body.tipo)) return 'Tipo inválido';
  if (body.categoria_id != null && isNaN(Number(body.categoria_id))) return 'categoria_id inválido';
  if (body.marca_id != null && isNaN(Number(body.marca_id))) return 'marca_id inválido';
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
        COALESCE(inv_arr.inventario, '[]'::json) AS inventario,
        (SELECT nombre FROM categorias c WHERE c.id = p.categoria_id) AS categoria_nombre,
        (SELECT nombre FROM marcas m WHERE m.id = p.marca_id) AS marca_nombre
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
      return { ...p, stock: Number(p.stock), inventario, categoria_nombre: p.categoria_nombre || null, marca_nombre: p.marca_nombre || null };
    });
    res.json(productos);
  } catch (err) {
    console.error('Error en GET /api/productos:', err);
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
    const { nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url, categoria_id, marca_id } = payloadPost;
    const result = await sql`
      INSERT INTO productos (nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url, categoria_id, marca_id)
      VALUES (${nombre}, ${tipo}, ${unidad}, ${stock || 0}, ${costo || 0}, ${precio_venta || 0}, ${proveedor_id || null}, ${image_url || null}, ${categoria_id || null}, ${marca_id || null})
      RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Error creando producto:', err);
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
    console.error('Error GET /api/productos/:id:', err);
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
    const { nombre, tipo, unidad, stock, costo, precio_venta, proveedor_id, image_url, categoria_id, marca_id } = payloadPut;
    // Evitar sobrescribir image_url con NULL cuando el cliente no envía ese campo.
    // COALESCE(${image_url}, image_url) usará el valor enviado o mantendrá el existente.
    const result = await sql`
      UPDATE productos SET nombre=${nombre}, tipo=${tipo}, unidad=${unidad}, stock=${stock}, costo=${costo}, precio_venta=${precio_venta}, proveedor_id=${proveedor_id}, image_url=COALESCE(${image_url}, image_url), categoria_id=${categoria_id}, marca_id=${marca_id}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    console.error('Error actualizando producto:', err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar producto
router.delete('/:id', async (req, res) => {
  try {
    const prodId = Number(req.params.id);
    if (isNaN(prodId)) return res.status(400).json({ error: 'ID inválido' });
    // 1) Verificar stock en inventario
    const stockRows = await sql`SELECT COALESCE(SUM(stock_fisico - stock_comprometido),0) AS disponible FROM inventario WHERE producto_id = ${prodId}`;
    const disponible = stockRows && stockRows[0] ? Number(stockRows[0].disponible) : 0;
    if (disponible > 0) return res.status(400).json({ error: 'No se puede eliminar el producto: existe stock en inventario' });
    // 2) Verificar que el producto no esté en pedidos de venta
    const pv = await sql`SELECT COUNT(*)::int AS c FROM pedido_venta_productos WHERE producto_id = ${prodId}`;
    if (pv && pv[0] && Number(pv[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar el producto: está presente en pedidos de venta' });
    // 3) Verificar que el producto no esté en pedidos de compra
    const pc = await sql`SELECT COUNT(*)::int AS c FROM pedido_compra_productos WHERE producto_id = ${prodId}`;
    if (pc && pc[0] && Number(pc[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar el producto: está presente en pedidos de compra' });
    // 4) Verificar que no sea materia prima en una fórmula
    const fc = await sql`SELECT COUNT(*)::int AS c FROM formula_componentes WHERE materia_prima_id = ${prodId}`;
    if (fc && fc[0] && Number(fc[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar el producto: se usa como materia prima en una fórmula' });
    // 5) Verificar que no sea producto terminado en una fórmula
    const ff = await sql`SELECT COUNT(*)::int AS c FROM formulas WHERE producto_terminado_id = ${prodId}`;
    if (ff && ff[0] && Number(ff[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar el producto: está referenciado en una fórmula' });

    const result = await sql`DELETE FROM productos WHERE id = ${prodId} RETURNING *`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, producto: result[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Añadir almacén a un producto y colocar existencia en una sola llamada
// POST /api/productos/:id/almacen
router.post('/:id/almacen', async (req, res) => {
  const prodId = Number(req.params.id);
  const { almacen_id, cantidad, motivo, referencia } = req.body || {};
  if (isNaN(prodId)) return res.status(400).json({ error: 'ID de producto inválido' });
  if (!almacen_id || isNaN(Number(almacen_id))) return res.status(400).json({ error: 'almacen_id requerido e inválido' });
  if (cantidad == null || isNaN(Number(cantidad))) return res.status(400).json({ error: 'cantidad requerida y debe ser numérica' });
  const qty = Number(cantidad);
  if (qty < 0) return res.status(400).json({ error: 'cantidad debe ser >= 0 al crear inventario' });

  try {
    await sql`BEGIN`;
    // Verificar producto
    const prod = await sql`SELECT id FROM productos WHERE id = ${prodId} FOR NO KEY UPDATE`;
    if (!prod || prod.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    // Verificar almacén
    const alm = await sql`SELECT id, nombre FROM almacenes WHERE id = ${almacen_id} FOR NO KEY UPDATE`;
    if (!alm || alm.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Almacén no encontrado' });
    }
    // Buscar inventario existente (bloqueo)
    const invRows = await sql`SELECT * FROM inventario WHERE producto_id = ${prodId} AND almacen_id = ${almacen_id} FOR UPDATE`;
    let inventory;
    if (invRows && invRows.length > 0) {
      // Si ya existe, incrementamos stock_fisico
      const updated = await sql`
        UPDATE inventario SET stock_fisico = stock_fisico + ${qty}
        WHERE id = ${invRows[0].id}
        RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido
      `;
      inventory = updated[0];
      await sql`COMMIT`;
      return res.json({ success: true, message: 'Inventario actualizado', data: { ...inventory, stock_disponible: Number(inventory.stock_fisico) - Number(inventory.stock_comprometido), motivo: motivo || null, referencia: referencia || null } });
    } else {
      // Crear nuevo inventario con stock_comprometido = 0
      const created = await sql`
        INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido)
        VALUES (${prodId}, ${almacen_id}, ${qty}, 0)
        RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido
      `;
      inventory = created[0];
      await sql`COMMIT`;
      return res.status(201).json({ success: true, message: 'Inventario creado', data: { ...inventory, stock_disponible: Number(inventory.stock_fisico) - Number(inventory.stock_comprometido), motivo: motivo || null, referencia: referencia || null } });
    }
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) { /* ignore */ }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
