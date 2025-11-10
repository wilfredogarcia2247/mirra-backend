const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarFormula(body) {
  if (!body.producto_terminado_id || isNaN(Number(body.producto_terminado_id))) return 'ID de producto terminado requerido';
  if (!Array.isArray(body.componentes) || body.componentes.length === 0) return 'Componentes requeridos';
  for (const c of body.componentes) {
    if (!c.materia_prima_id || isNaN(Number(c.materia_prima_id))) return 'ID de materia prima requerido';
    if (!c.cantidad || isNaN(Number(c.cantidad))) return 'Cantidad requerida';
    if (!c.unidad || typeof c.unidad !== 'string') return 'Unidad requerida';
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    const formulas = await sql`SELECT * FROM formulas`;
    for (const f of formulas) {
      f.componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${f.id}`;
    }
    res.json(formulas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarFormula(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { producto_terminado_id, componentes } = req.body;
    const formula = await sql`
      INSERT INTO formulas (producto_terminado_id)
      VALUES (${producto_terminado_id}) RETURNING *
    `;
    for (const c of componentes) {
      await sql`
        INSERT INTO formula_componentes (formula_id, materia_prima_id, cantidad, unidad)
        VALUES (${formula[0].id}, ${c.materia_prima_id}, ${c.cantidad}, ${c.unidad})
      `;
    }
    formula[0].componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formula[0].id}`;
    res.status(201).json(formula[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar una fórmula completa (producto_terminado_id y sus componentes)
// PUT /api/formulas/:id
router.put('/:id', async (req, res) => {
  const formulaId = Number(req.params.id);
  if (isNaN(formulaId)) return res.status(400).json({ error: 'ID inválido' });
  const error = validarFormula(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { producto_terminado_id, componentes } = req.body;
    await sql`BEGIN`;
    // Verificar que la fórmula exista
    const f = await sql`SELECT * FROM formulas WHERE id = ${formulaId} FOR NO KEY UPDATE`;
    if (!f || f.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Fórmula no encontrada' });
    }
    // Actualizar producto_terminado_id
    await sql`UPDATE formulas SET producto_terminado_id = ${producto_terminado_id} WHERE id = ${formulaId}`;
    // Reemplazar componentes: eliminar existentes e insertar nuevos
    await sql`DELETE FROM formula_componentes WHERE formula_id = ${formulaId}`;
    for (const c of componentes) {
      await sql`INSERT INTO formula_componentes (formula_id, materia_prima_id, cantidad, unidad) VALUES (${formulaId}, ${c.materia_prima_id}, ${c.cantidad}, ${c.unidad})`;
    }
    await sql`COMMIT`;
    const updated = await sql`SELECT * FROM formulas WHERE id = ${formulaId}`;
    updated[0].componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
    res.json(updated[0]);
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una fórmula
// DELETE /api/formulas/:id
router.delete('/:id', async (req, res) => {
  const formulaId = Number(req.params.id);
  if (isNaN(formulaId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar que no existan ordenes de producción asociadas
    const ops = await sql`SELECT COUNT(*)::int AS c FROM ordenes_produccion WHERE formula_id = ${formulaId}`;
    if (ops && ops[0] && Number(ops[0].c) > 0) return res.status(400).json({ error: 'No se puede eliminar la fórmula: existen órdenes de producción asociadas' });
    await sql`BEGIN`;
    await sql`DELETE FROM formula_componentes WHERE formula_id = ${formulaId}`;
    const deleted = await sql`DELETE FROM formulas WHERE id = ${formulaId} RETURNING *`;
    await sql`COMMIT`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'Fórmula no encontrada' });
    res.json({ eliminado: true, formula: deleted[0] });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const formula = await sql`SELECT * FROM formulas WHERE id = ${req.params.id}`;
    if (formula.length === 0) return res.status(404).json({ error: 'No encontrado' });
    formula[0].componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${req.params.id}`;
    res.json(formula[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear y completar producción a partir de una fórmula
// POST /api/formulas/:id/produccion
// Body: { cantidad, almacen_venta_id }
router.post('/:id/produccion', async (req, res) => {
  const formulaId = Number(req.params.id);
  const { cantidad, almacen_venta_id } = req.body || {};
  if (isNaN(formulaId)) return res.status(400).json({ error: 'ID de fórmula inválido' });
  if (cantidad == null || isNaN(Number(cantidad)) || Number(cantidad) <= 0) return res.status(400).json({ error: 'cantidad requerida y debe ser > 0' });
  if (!almacen_venta_id || isNaN(Number(almacen_venta_id))) return res.status(400).json({ error: 'almacen_venta_id requerido e inválido' });
  const qty = Number(cantidad);

  try {
    await sql`BEGIN`;
    // Verificar fórmula
    const f = await sql`SELECT * FROM formulas WHERE id = ${formulaId} FOR NO KEY UPDATE`;
    if (!f || f.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Fórmula no encontrada' });
    }
    // Verificar almacén destino y que sea tipo 'Venta'
    const dest = await sql`SELECT * FROM almacenes WHERE id = ${almacen_venta_id} FOR NO KEY UPDATE`;
    if (!dest || dest.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Almacén destino no encontrado' });
    }
    if (dest[0].tipo !== 'Venta') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'El almacén destino debe ser de tipo Venta' });
    }

    // Obtener componentes
    const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
    if (!componentes || componentes.length === 0) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'La fórmula no tiene componentes' });
    }

    // Verificar disponibilidad de materia prima en almacenes MateriaPrima
    for (const comp of componentes) {
      const required = Number(comp.cantidad) * qty;
      const mpInventarios = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
        ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        FOR UPDATE
      `;
      let totalAvailable = 0;
      for (const inv of mpInventarios) totalAvailable += Number(inv.stock_fisico) - Number(inv.stock_comprometido);
      if (totalAvailable < required) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: `Materia prima ${comp.materia_prima_id} insuficiente` });
      }
    }

    // Crear orden de producción y consumir materia prima, luego insertar/actualizar inventario del producto terminado en almacén Venta
    const orden = await sql`
      INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha)
      VALUES (${f[0].producto_terminado_id}, ${qty}, ${formulaId}, 'Completada', NOW()) RETURNING *
    `;

    const materialesMovidos = [];
    // Consumir materia prima
    for (const comp of componentes) {
      let required = Number(comp.cantidad) * qty;
      const mpInventarios = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
        ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        FOR UPDATE
      `;
      for (const inv of mpInventarios) {
        if (required <= 0) break;
        const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
        if (available <= 0) continue;
        const take = Math.min(available, required);
        // Consumir: restar stock_fisico
        await sql`UPDATE inventario SET stock_fisico = stock_fisico - ${take} WHERE id = ${inv.id}`;
        materialesMovidos.push({ materia_prima_id: comp.materia_prima_id, almacen_id: inv.almacen_id, cantidad: take });
        required -= take;
      }
    }

    // Añadir producto terminado al almacén de venta destino
    const prodId = f[0].producto_terminado_id;
    const existing = await sql`SELECT * FROM inventario WHERE producto_id = ${prodId} AND almacen_id = ${almacen_venta_id} FOR UPDATE`;
    let destinoInv;
    if (existing && existing.length > 0) {
      const up = await sql`UPDATE inventario SET stock_fisico = stock_fisico + ${qty} WHERE id = ${existing[0].id} RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = up[0];
    } else {
      const created = await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${prodId}, ${almacen_venta_id}, ${qty}, 0) RETURNING id, producto_id, almacen_id, stock_fisico, stock_comprometido`;
      destinoInv = created[0];
    }

    await sql`COMMIT`;
    return res.status(201).json({ success: true, orden: orden[0], materiales: materialesMovidos, inventario_destino: { ...destinoInv, stock_disponible: Number(destinoInv.stock_fisico) - Number(destinoInv.stock_comprometido) } });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
