const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarFormula(body) {
  if (!body.producto_terminado_id || isNaN(Number(body.producto_terminado_id))) return 'ID de producto terminado requerido';
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre de fórmula requerido';
  if (body.costo == null || isNaN(Number(body.costo))) return 'Costo de la fórmula requerido y debe ser numérico';
  if (body.precio_venta == null || isNaN(Number(body.precio_venta))) return 'Precio de venta de la fórmula requerido y debe ser numérico';
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
    // La tabla `tamanos` puede no existir en este esquema; las "versiones/tamaños" se representan ahora como filas en `formulas`.
    const formulas = await sql`SELECT f.* FROM formulas f ORDER BY f.producto_terminado_id, f.nombre`;
    for (const f of formulas) {
      f.componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${f.id}`;
      // Las propiedades de tamaño ahora están en la propia fórmula: nombre, costo, precio_venta
      f.tamano = { id: f.id, nombre: f.nombre, cantidad: f.cantidad || null, unidad: f.unidad || null, costo: f.costo, precio_venta: f.precio_venta };
      // Mantener campos de fórmula principales
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
    // Asegurar columna nombre en DB si por alguna razón la migración no se ejecutó
    try { await sql`ALTER TABLE formulas ADD COLUMN nombre VARCHAR(200);`; } catch (e) {}
    try { await sql`ALTER TABLE formulas ADD COLUMN costo NUMERIC;`; } catch (e) {}
    try { await sql`ALTER TABLE formulas ADD COLUMN precio_venta NUMERIC;`; } catch (e) {}
    const { producto_terminado_id, componentes, nombre, tamano_id } = req.body;
    const { costo, precio_venta } = req.body;
    // Verificar que el tamaño existe y pertenece al producto terminado
    // tamano_id legacy: aceptamos valor si se provee, pero la tabla `tamanos` puede no existir.
    let tam = tamano_id ? tamano_id : null;
    const formula = await sql`
      INSERT INTO formulas (producto_terminado_id, nombre, tamano_id, costo, precio_venta)
      VALUES (${producto_terminado_id}, ${nombre}, ${tam}, ${costo}, ${precio_venta}) RETURNING *
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
    // Asegurar columna nombre en DB si por alguna razón la migración no se ejecutó
    try { await sql`ALTER TABLE formulas ADD COLUMN nombre VARCHAR(200);`; } catch (e) {}
    const { producto_terminado_id, componentes, nombre, tamano_id } = req.body;
    const { costo, precio_venta } = req.body;
    // Verificar que el tamaño existe y pertenece al producto terminado
    // tamano_id legacy: aceptamos valor si se provee, pero la tabla `tamanos` puede no existir.
    let tam = tamano_id ? tamano_id : null;
    await sql`BEGIN`;
    // Verificar que la fórmula exista
    const f = await sql`SELECT * FROM formulas WHERE id = ${formulaId} FOR NO KEY UPDATE`;
    if (!f || f.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Fórmula no encontrada' });
    }
    // Actualizar producto_terminado_id
  await sql`UPDATE formulas SET producto_terminado_id = ${producto_terminado_id}, nombre = ${nombre}, tamano_id = ${tam}, costo = ${costo}, precio_venta = ${precio_venta} WHERE id = ${formulaId}`;
    // Reemplazar componentes: eliminar existentes e insertar nuevos
    await sql`DELETE FROM formula_componentes WHERE formula_id = ${formulaId}`;
    for (const c of componentes) {
      await sql`INSERT INTO formula_componentes (formula_id, materia_prima_id, cantidad, unidad) VALUES (${formulaId}, ${c.materia_prima_id}, ${c.cantidad}, ${c.unidad})`;
    }
    await sql`COMMIT`;
    const updated = await sql`SELECT * FROM formulas WHERE id = ${formulaId}`;
    updated[0].componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
    // Adjuntar información de la propia fórmula como 'tamano' (compatibilidad)
    updated[0].tamano = { id: updated[0].id, nombre: updated[0].nombre, cantidad: updated[0].cantidad || null, unidad: updated[0].unidad || null, costo: updated[0].costo, precio_venta: updated[0].precio_venta };
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
    const formula = await sql`SELECT f.* FROM formulas f WHERE f.id = ${req.params.id}`;
    if (formula.length === 0) return res.status(404).json({ error: 'No encontrado' });
    formula[0].componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${req.params.id}`;
    formula[0].tamano = { id: formula[0].id, nombre: formula[0].nombre, cantidad: formula[0].cantidad || null, unidad: formula[0].unidad || null, costo: formula[0].costo, precio_venta: formula[0].precio_venta };
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
    // Validación: el almacén destino no debe estar marcado como materia prima
    if (dest[0].es_materia_prima === true) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'El almacén destino no puede ser marcado como materia prima' });
    }

    // Obtener componentes
    const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
    if (!componentes || componentes.length === 0) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'La fórmula no tiene componentes' });
    }

    // Verificar disponibilidad de materia prima en almacenes Interno
    for (const comp of componentes) {
      const required = Number(comp.cantidad) * qty;
      const mpInventarios = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${comp.materia_prima_id} AND a.es_materia_prima = true
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
        WHERE i.producto_id = ${comp.materia_prima_id} AND LOWER(a.tipo) = 'interno'
        ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        FOR UPDATE
      `;
      for (const inv of mpInventarios) {
        if (required <= 0) break;
        const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
        if (available <= 0) continue;
        const take = Math.min(available, required);
        // Consumir: restar stock_fisico de forma segura (no permitir dejar negativo)
        const updatedInv = await sql`
          UPDATE inventario SET stock_fisico = stock_fisico - ${take}
          WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0
          RETURNING id, stock_fisico, stock_comprometido, almacen_id
        `;
        if (!updatedInv || updatedInv.length === 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: `Inventario insuficiente al consumir materia prima id ${comp.materia_prima_id}` });
        }
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
