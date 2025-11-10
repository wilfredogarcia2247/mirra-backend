const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);


function validarPedido(body) {
  // Para pedidos públicos `cliente_id` es opcional (puede venir null/0).
  if (body.cliente_id != null && body.cliente_id !== '' && isNaN(Number(body.cliente_id))) return 'ID de cliente inválido';
  // Aceptamos compatiblemente `productos` o `lineas` como nombre del array enviado desde el front
  const productosArray = Array.isArray(body.productos) ? body.productos : (Array.isArray(body.lineas) ? body.lineas : null);
  if (!Array.isArray(productosArray) || productosArray.length === 0) return 'Productos (array `productos` o `lineas`) requeridos';
  for (const p of productosArray) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return 'ID de producto requerido';
    if (!p.cantidad || isNaN(Number(p.cantidad))) return 'Cantidad requerida';
  }
  // estado es opcional para pedidos públicos (se fuerza a 'Pendiente' en la inserción)
  if (body.estado != null && !['Pendiente', 'Enviado', 'Completado'].includes(body.estado)) return 'Estado inválido';
  // Si se provee tasa_cambio_monto debe ser un número positivo
  if (body.tasa_cambio_monto != null && (isNaN(Number(body.tasa_cambio_monto)) || Number(body.tasa_cambio_monto) <= 0)) return 'tasa_cambio_monto inválida';
  return null;
}

// Endpoint público para crear pedidos de venta (no requiere token)
router.post('/', async (req, res) => {
  console.log('Public POST /api/pedidos-venta body:', req.body);
  const error = validarPedido(req.body);
  if (error) return res.status(400).json({ error });
  try {
  // Asegurar columnas de snapshot por si la migración no se ejecutó en este entorno
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN costo_unitario NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN nombre_producto TEXT;`; } catch(e) {}
  const { cliente_id, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto } = req.body;
    // Compatibilidad: aceptar `productos` o `lineas`
    const productos = Array.isArray(req.body.productos) ? req.body.productos : (Array.isArray(req.body.lineas) ? req.body.lineas : []);
    // Si cliente_id no se provee o es 0, lo almacenamos como NULL (pedido público)
    const clienteIdValue = (cliente_id == null || Number(cliente_id) === 0) ? null : Number(cliente_id);
    const forcedEstado = 'Pendiente';
    // Capturar IP y User-Agent para trazabilidad
    const origenIp = (req.headers['x-forwarded-for'] || req.ip || '').toString();
    const userAgent = (req.headers['user-agent'] || '').toString();

    // Ejecutar en transacción similar a la variante protegida: reservar stock de venta y crear órdenes de producción si hace falta
    await sql`BEGIN`;
    try {
      const produccionesCreadas = [];
  for (const p of productos) {
        let qtyNeeded = Number(p.cantidad);
        if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Cantidad inválida en productos' });
        }
        const inventariosVenta = await sql`
          SELECT i.* FROM inventario i
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE i.producto_id = ${p.producto_id} AND a.tipo = 'Venta'
          ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        `;
        for (const inv of inventariosVenta) {
          const disponible = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
          if (disponible <= 0) continue;
          const take = Math.min(disponible, qtyNeeded);
          await sql`UPDATE inventario SET stock_comprometido = stock_comprometido + ${take} WHERE id = ${inv.id}`;
          qtyNeeded -= take;
          if (qtyNeeded === 0) break;
        }
        if (qtyNeeded > 0) {
          const formula = await sql`SELECT * FROM formulas WHERE producto_terminado_id = ${p.producto_id}`;
          if (formula.length === 0) {
            await sql`ROLLBACK`;
            return res.status(400).json({ error: `Producto ${p.producto_id} sin stock suficiente y sin fórmula para producir` });
          }
          const formulaId = formula[0].id;
          const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
          for (const comp of componentes) {
            const required = Number(comp.cantidad) * qtyNeeded;
            const mpInventarios = await sql`
              SELECT i.* FROM inventario i
              JOIN almacenes a ON a.id = i.almacen_id
              WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
              ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
            `;
            let totalDisponible = 0;
            for (const inv of mpInventarios) totalDisponible += Number(inv.stock_fisico) - Number(inv.stock_comprometido);
            if (totalDisponible < required) {
              await sql`ROLLBACK`;
              return res.status(400).json({ error: `Materia prima ${comp.materia_prima_id} insuficiente para producir producto ${p.producto_id}` });
            }
          }
          const orden = await sql`
            INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha)
            VALUES (${p.producto_id}, ${qtyNeeded}, ${formulaId}, 'Pendiente', NOW()) RETURNING *
          `;
          produccionesCreadas.push(orden[0]);
          for (const comp of componentes) {
            let required = Number(comp.cantidad) * qtyNeeded;
            const mpInventarios = await sql`
              SELECT i.* FROM inventario i
              JOIN almacenes a ON a.id = i.almacen_id
              WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
              ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
            `;
            for (const inv of mpInventarios) {
              if (required <= 0) break;
              const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
              if (available <= 0) continue;
              const take = Math.min(available, required);
              await sql`UPDATE inventario SET stock_comprometido = stock_comprometido + ${take} WHERE id = ${inv.id}`;
              required -= take;
            }
          }
        }
      }
      const tasaMontoVal = tasa_cambio_monto != null ? Number(tasa_cambio_monto) : null;

      // Insertar pedido público
      const pedido = await sql`
        INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha, origen_ip, user_agent, tasa_cambio_monto)
        VALUES (${clienteIdValue}, ${nombre_cliente || null}, ${telefono || null}, ${cedula || null}, ${forcedEstado}, NOW(), ${origenIp || null}, ${userAgent || null}, ${tasaMontoVal}) RETURNING *
      `;
  for (const p of productos) {
        // Obtener precio/costo/nombre actual para snapshot en pedido público
        const prodRow = await sql`SELECT precio_venta, costo, nombre FROM productos WHERE id = ${p.producto_id}`;
  const precioUnitario = (prodRow && prodRow[0] && prodRow[0].precio_venta != null) ? prodRow[0].precio_venta : null;
  const costoUnitario = (prodRow && prodRow[0] && prodRow[0].costo != null) ? prodRow[0].costo : null;
  const nombreProducto = (prodRow && prodRow[0] && prodRow[0].nombre != null) ? prodRow[0].nombre : null;
  await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto) VALUES (${pedido[0].id}, ${p.producto_id}, ${p.cantidad}, ${costoUnitario}, ${precioUnitario}, ${nombreProducto})`;
      }
      await sql`COMMIT`;

      const productosDetalle = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
               COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
               COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
               COALESCE(pv.costo_unitario, prod.costo) AS costo,
               prod.image_url
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
      const pedidoObj = { ...pedido[0], productos: productosMapeados, total, producciones: produccionesCreadas };
      res.status(201).json(pedidoObj);
    } catch (errTx) {
      try { await sql`ROLLBACK`; } catch (e) {}
      throw errTx;
    }
  } catch (err) {
    console.error('Error creating public pedido:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
