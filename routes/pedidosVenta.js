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
    // Ejecutar en transacción: reservar stock de venta, crear orden de producción si hace falta y crear pedido
    await sql`BEGIN`;
    try {
      // Reserva/producción acumulados para retornar
      const produccionesCreadas = [];

      // Primero validar disponibilidad y reservar
      for (const p of productos) {
        let qtyNeeded = Number(p.cantidad);
        if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Cantidad inválida en productos' });
        }
        // Intentar reservar desde almacenes de tipo 'Venta'
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
          await sql`
            UPDATE inventario SET stock_comprometido = stock_comprometido + ${take} WHERE id = ${inv.id}
          `;
          qtyNeeded -= take;
          if (qtyNeeded === 0) break;
        }

        if (qtyNeeded > 0) {
          // No hay suficiente en venta, intentar producir desde materia prima
          // Buscar fórmula del producto terminado
          const formula = await sql`SELECT * FROM formulas WHERE producto_terminado_id = ${p.producto_id}`;
          if (formula.length === 0) {
            await sql`ROLLBACK`;
            return res.status(400).json({ error: `Producto ${p.producto_id} sin stock suficiente y sin fórmula para producir` });
          }
          const formulaId = formula[0].id;
          // Obtener componentes
          const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
          // Verificar disponibilidad de materia prima para producir qtyNeeded unidades
          for (const comp of componentes) {
            const required = Number(comp.cantidad) * qtyNeeded;
            // sumar stock disponible en almacenes MateriaPrima
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
          // Si llegamos aquí hay materia prima suficiente -> crear orden de producción
          const orden = await sql`
            INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha)
            VALUES (${p.producto_id}, ${qtyNeeded}, ${formulaId}, 'Pendiente', NOW()) RETURNING *
          `;
          produccionesCreadas.push(orden[0]);
          // Reservar materia prima (incrementar stock_comprometido) distribuyendo entre inventarios
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

      // Si llegamos aquí, todo reservado/ordenado correctamente -> insertar pedido y sus líneas
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
      // Commit
      await sql`COMMIT`;

      // Recuperar y devolver pedido con detalle (como antes)
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
      const pedidoObj = { ...pedido[0], productos: productosMapeados, total, producciones: produccionesCreadas };
      return res.status(201).json(pedidoObj);
    } catch (errTx) {
      try { await sql`ROLLBACK`; } catch (e) {}
      throw errTx;
    }
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

// Completar un pedido de venta: consumir las reservas (stock_comprometido) en almacenes 'Venta'
// POST /api/pedidos-venta/:id/completar
router.post('/:id/completar', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await sql`BEGIN`;
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.estado === 'Completado') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'Pedido ya completado' });
    }

    // Obtener líneas del pedido
    const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
    const movimientos = [];

    for (const linea of lineas) {
      let qtyNeeded = Number(linea.cantidad);
      if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'Cantidad inválida en líneas del pedido' });
      }
      // Obtener inventarios de tipo Venta donde hay stock_comprometido (reservas), bloquear filas
      const invs = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${linea.producto_id} AND a.tipo = 'Venta' AND i.stock_comprometido > 0
        ORDER BY i.stock_comprometido DESC
        FOR UPDATE
      `;
      for (const inv of invs) {
        if (qtyNeeded <= 0) break;
        const committed = Number(inv.stock_comprometido);
        if (committed <= 0) continue;
        const take = Math.min(committed, qtyNeeded);
        // Consumir de forma segura: asegurar que stock_fisico no quede negativo y stock_comprometido suficiente
        const consumed = await sql`
          UPDATE inventario
          SET stock_fisico = stock_fisico - ${take}, stock_comprometido = stock_comprometido - ${take}
          WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0 AND stock_comprometido >= ${take}
          RETURNING id, stock_fisico, stock_comprometido, almacen_id
        `;
        if (!consumed || consumed.length === 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: `No se pudo consumir inventario reservado para producto ${linea.producto_id}` });
        }
        // Registrar movimiento
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id}, ${inv.almacen_id}, 'salida', ${take}, ${'Venta pedido ' + pedidoId})`;
        movimientos.push({ producto_id: linea.producto_id, almacen_id: inv.almacen_id, cantidad: take });
        qtyNeeded -= take;
      }
      if (qtyNeeded > 0) {
        // Esto indica inconsistencia: se habían reservado menos de lo esperado o consumido por otro proceso
        await sql`ROLLBACK`;
        return res.status(400).json({ error: `Stock comprometido insuficiente para producto ${linea.producto_id}` });
      }
    }

    // Marcar pedido como Completado
    await sql`UPDATE pedidos_venta SET estado = 'Completado' WHERE id = ${pedidoId}`;
    await sql`COMMIT`;
    return res.json({ success: true, pedido_id: pedidoId, movimientos });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
