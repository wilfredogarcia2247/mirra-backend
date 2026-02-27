const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarOrden(body) {
  if (!body.producto_terminado_id || isNaN(Number(body.producto_terminado_id)))
    return 'ID de producto terminado requerido';
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

// GET /api/ordenes-produccion/detailed
// Devuelve órdenes de producción con nombre del producto terminado y los componentes que usa
// Soporta filtro opcional: ?pedido_id=X
router.get('/detailed', async (req, res) => {
  try {
    const { pedido_id } = req.query;

    // Construir consulta optimizada con JSON aggregation para evitar N+1
    let query;
    if (pedido_id != null && !isNaN(Number(pedido_id))) {
      // Filtrar por pedido_venta_id si se proporciona
      query = sql`
        SELECT 
          o.id, o.producto_terminado_id, o.cantidad, o.formula_id, o.estado, o.fecha, o.pedido_venta_id,
          p.nombre as producto_nombre,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'materia_prima_id', fc.materia_prima_id,
                'materia_nombre', COALESCE(prod.nombre, ing.nombre),
                'cantidad_por_unidad', fc.cantidad,
                'unidad', fc.unidad,
                'cantidad_total', fc.cantidad * o.cantidad
              )
              ORDER BY fc.id
            ) FILTER (WHERE fc.id IS NOT NULL),
            '[]'::jsonb
          ) as componentes
        FROM ordenes_produccion o
        LEFT JOIN productos p ON p.id = o.producto_terminado_id
        LEFT JOIN formula_componentes fc ON fc.formula_id = o.formula_id
        LEFT JOIN productos prod ON prod.id = fc.materia_prima_id
        LEFT JOIN ingredientes ing ON ing.id = fc.materia_prima_id
        WHERE o.pedido_venta_id = ${Number(pedido_id)}
        GROUP BY o.id, p.nombre
        ORDER BY o.id DESC
      `;
    } else {
      // Sin filtro: devolver todas las órdenes
      query = sql`
        SELECT 
          o.id, o.producto_terminado_id, o.cantidad, o.formula_id, o.estado, o.fecha, o.pedido_venta_id,
          p.nombre as producto_nombre,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'materia_prima_id', fc.materia_prima_id,
                'materia_nombre', COALESCE(prod.nombre, ing.nombre),
                'cantidad_por_unidad', fc.cantidad,
                'unidad', fc.unidad,
                'cantidad_total', fc.cantidad * o.cantidad
              )
              ORDER BY fc.id
            ) FILTER (WHERE fc.id IS NOT NULL),
            '[]'::jsonb
          ) as componentes
        FROM ordenes_produccion o
        LEFT JOIN productos p ON p.id = o.producto_terminado_id
        LEFT JOIN formula_componentes fc ON fc.formula_id = o.formula_id
        LEFT JOIN productos prod ON prod.id = fc.materia_prima_id
        LEFT JOIN ingredientes ing ON ing.id = fc.materia_prima_id
        GROUP BY o.id, p.nombre
        ORDER BY o.id DESC
      `;
    }

    const ordenes = await query;

    // Mapear resultado con componentes ya agregados
    const detailed = ordenes.map(ord => ({
      orden: {
        id: ord.id,
        producto_terminado_id: ord.producto_terminado_id,
        cantidad: ord.cantidad,
        formula_id: ord.formula_id,
        estado: ord.estado,
        fecha: ord.fecha,
        pedido_venta_id: ord.pedido_venta_id
      },
      producto_nombre: ord.producto_nombre || null,
      componentes: ord.componentes
    }));

    res.json(detailed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarOrden(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { producto_terminado_id, cantidad, formula_id, estado, pedido_venta_id } = req.body;
    const result = await sql`
      INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha, pedido_venta_id)
      VALUES (${producto_terminado_id}, ${cantidad}, ${formula_id}, ${estado}, NOW(), ${pedido_venta_id || null}) RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Completar una orden de producción: consumir materia prima y guardar producto terminado en almacén destino
// POST /api/ordenes-produccion/:id/completar
// Body: { almacen_venta_id, componentes_utilizados: [{ materia_prima_id, cantidad_total }] (opcional) }
router.post('/:id/completar', async (req, res) => {
  const ordenId = Number(req.params.id);
  const { almacen_venta_id, componentes_utilizados } = req.body || {};

  console.log('--- PETICIÓN DE DESCARGO (PRODUCCIÓN) ---');
  console.log(`Orden ID: ${ordenId}`);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-----------------------------------------');

  if (isNaN(ordenId)) return res.status(400).json({ error: 'ID inválido' });
  if (!almacen_venta_id || isNaN(Number(almacen_venta_id)))
    return res.status(400).json({ error: 'almacen_venta_id requerido e inválido' });
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
    const dest =
      await sql`SELECT * FROM almacenes WHERE id = ${almacen_venta_id} FOR NO KEY UPDATE`;
    if (!dest || dest.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Almacén destino no encontrado' });
    }
    if (dest[0].es_materia_prima === true) {
      await sql`ROLLBACK`;
      return res
        .status(400)
        .json({ error: 'El almacén destino no puede ser marcado como materia prima' });
    }

    // Determinar qué componentes consumir
    let itemsToConsume = [];
    const qty = Number(ord.cantidad);

    if (componentes_utilizados && Array.isArray(componentes_utilizados) && componentes_utilizados.length > 0) {
      // Opción 1: El usuario envió cantidades manuales (Hubo cambios/errores en producción)
      for (const c of componentes_utilizados) {
        if (!c.materia_prima_id || isNaN(Number(c.materia_prima_id))) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'ID de materia prima inválido en componentes utilizados' });
        }
        const cant = Number(c.cantidad_total);
        if (isNaN(cant) || cant < 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Cantidad total inválida en componentes utilizados' });
        }
        itemsToConsume.push({
          materia_prima_id: c.materia_prima_id,
          cantidad_total: cant
        });
      }
    } else {
      // Opción 2: Producción perfecta, usar Fórmula estándar
      const componentes =
        await sql`SELECT * FROM formula_componentes WHERE formula_id = ${ord.formula_id}`;
      // Si la fórmula no tiene componentes, no es un error critico, simplemente no se consume nada (puede ser un producto simple)
      if (componentes && componentes.length > 0) {
        itemsToConsume = componentes.map(comp => ({
          materia_prima_id: comp.materia_prima_id,
          cantidad_total: Number(comp.cantidad) * qty
        }));
      }
    }

    const movimientos = [];

    // Verificar disponibilidad y consumir materia prima desde almacenes marcados como materia prima
    for (const item of itemsToConsume) {
      let required = item.cantidad_total;

      // Si la cantidad es 0, no consumimos nada (ej. no se usó ese componente)
      if (required <= 0) continue;

      const mpInventarios = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${item.materia_prima_id} AND a.es_materia_prima = true
        ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        FOR UPDATE
      `;

      let totalAvailable = 0;
      for (const inv of mpInventarios)
        totalAvailable += Number(inv.stock_fisico) - Number(inv.stock_comprometido);

      if (totalAvailable < required) {
        await sql`ROLLBACK`;
        return res
          .status(400)
          .json({ error: `Materia prima ${item.materia_prima_id} insuficiente. Requerido: ${required}, Disponible: ${totalAvailable}` });
      }

      // Consumir inventario (queries individuales pero dentro de transacción = rápido)
      for (const inv of mpInventarios) {
        if (required <= 0) break;
        const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
        if (available <= 0) continue;
        const take = Math.min(available, required);

        const consumed = await sql`
          UPDATE inventario
          SET stock_fisico = stock_fisico - ${take}, 
              stock_comprometido = GREATEST(0, stock_comprometido - ${take})
          WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0
          RETURNING id, stock_fisico, stock_comprometido
        `;

        if (!consumed || consumed.length === 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({
            error: `Inventario insuficiente al consumir materia prima id ${item.materia_prima_id}`,
          });
        }

        await sql`
          INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) 
          VALUES (${item.materia_prima_id}, ${inv.almacen_id}, 'salida', ${take}, ${'Producción orden ' + ordenId})
        `;

        movimientos.push({
          materia_prima_id: item.materia_prima_id,
          almacen_id: inv.almacen_id,
          cantidad: take,
        });

        required -= take;
      }
    }

    // Incrementar inventario del producto terminado en almacen destino
    const prodId = ord.producto_terminado_id;
    const existing =
      await sql`SELECT * FROM inventario WHERE producto_id = ${prodId} AND almacen_id = ${almacen_venta_id} FOR UPDATE`;
    let destinoInv;
    if (existing && existing.length > 0) {
      const up =
        await sql`UPDATE inventario SET stock_fisico = stock_fisico + ${qty} WHERE id = ${existing[0].id} RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = up[0];
    } else {
      const created =
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${prodId}, ${almacen_venta_id}, ${qty}, 0) RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = created[0];
    }
    await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${prodId}, ${almacen_venta_id}, 'entrada', ${qty}, ${'Producción orden ' + ordenId
      })`;

    await sql`UPDATE ordenes_produccion SET estado = 'Completada' WHERE id = ${ordenId}`;

    await sql`COMMIT`;
    return res.json({
      success: true,
      orden: { ...ord, estado: 'Completada' },
      movimientos,
      inventario_destino: {
        ...destinoInv,
        stock_disponible: Number(destinoInv.stock_fisico) - Number(destinoInv.stock_comprometido),
      },
    });
  } catch (err) {
    try {
      await sql`ROLLBACK`;
    } catch (e) { }
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
