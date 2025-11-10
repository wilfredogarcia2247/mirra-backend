const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarPedido(body) {
  if (!body.cliente_id || isNaN(Number(body.cliente_id))) return 'ID de cliente requerido';
  if (!Array.isArray(body.productos) || body.productos.length === 0) return 'Productos requeridos';
  for (const p of body.productos) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return 'ID de producto requerido';
    if (!p.cantidad || isNaN(Number(p.cantidad))) return 'Cantidad requerida';
  }
  if (!body.estado || !['Pendiente', 'Enviado', 'Completado'].includes(body.estado)) return 'Estado inválido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const pedidos = await sql`SELECT * FROM pedidos_venta`;
    const pedidosConDetalle = [];
    for (const p of pedidos) {
      const productos = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
               prod.nombre AS producto_nombre, prod.precio_venta, prod.costo, prod.image_url
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        WHERE pv.pedido_venta_id = ${p.id}
      `;
      // Normalizar tipos y calcular subtotales
      let total = 0;
      const productosMapeados = productos.map(item => {
        const cantidad = Number(item.cantidad);
        const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
        const costo = item.costo != null ? parseFloat(item.costo) : null;
        const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
        total += subtotal;
        return {
          id: item.id,
          pedido_venta_id: item.pedido_venta_id,
          producto_id: item.producto_id,
          cantidad,
          producto_nombre: item.producto_nombre,
          precio_venta: isNaN(precio) ? null : precio,
          costo: costo,
          image_url: item.image_url,
          subtotal
        };
      });
      pedidosConDetalle.push({
        ...p,
        productos: productosMapeados,
        total
      });
    }
    res.json(pedidosConDetalle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarPedido(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { cliente_id, productos, estado, nombre_cliente, telefono, cedula } = req.body;
    // Insertar incluyendo campos opcionales nombre_cliente, telefono y cedula (si están presentes)
    const pedido = await sql`
      INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha)
      VALUES (${cliente_id || null}, ${nombre_cliente || null}, ${telefono || null}, ${cedula || null}, ${estado}, NOW()) RETURNING *
    `;
    for (const p of productos) {
      await sql`
        INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad)
        VALUES (${pedido[0].id}, ${p.producto_id}, ${p.cantidad})
      `;
    }
    // Recuperar productos con detalle y calcular total
    const productosDetalle = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
             prod.nombre AS producto_nombre, prod.precio_venta, prod.costo, prod.image_url
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.pedido_venta_id = ${pedido[0].id}
    `;
    let total = 0;
    const productosMapeados = productosDetalle.map(item => {
      const cantidad = Number(item.cantidad);
      const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
      const costo = item.costo != null ? parseFloat(item.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      total += subtotal;
      return {
        id: item.id,
        pedido_venta_id: item.pedido_venta_id,
        producto_id: item.producto_id,
        cantidad,
        producto_nombre: item.producto_nombre,
        precio_venta: isNaN(precio) ? null : precio,
        costo: costo,
        image_url: item.image_url,
        subtotal
      };
    });
    const pedidoObj = { ...pedido[0], productos: productosMapeados, total };
    res.status(201).json(pedidoObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pedido = await sql`SELECT * FROM pedidos_venta WHERE id = ${req.params.id}`;
    if (pedido.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const productos = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
             prod.nombre AS producto_nombre, prod.precio_venta, prod.costo, prod.image_url
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.pedido_venta_id = ${req.params.id}
    `;
    let total = 0;
    const productosMapeados = productos.map(item => {
      const cantidad = Number(item.cantidad);
      const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
      const costo = item.costo != null ? parseFloat(item.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      total += subtotal;
      return {
        id: item.id,
        pedido_venta_id: item.pedido_venta_id,
        producto_id: item.producto_id,
        cantidad,
        producto_nombre: item.producto_nombre,
        precio_venta: isNaN(precio) ? null : precio,
        costo: costo,
        image_url: item.image_url,
        subtotal
      };
    });
    const pedidoObj = { ...pedido[0], productos: productosMapeados, total };
    res.json(pedidoObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
