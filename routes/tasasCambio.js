const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const {
  buildPendingUnpaidOrderRateUpdateQuery,
  hasPaymentsTable,
} = require('../services/pendingOrderRateSync');

// Listar todas las tasas de cambio
router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM tasas_cambio ORDER BY id DESC`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error listando tasas de cambio' });
  }
});

// Obtener una tasa por id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM tasas_cambio WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error obteniendo tasa' });
  }
});

// Crear una tasa
router.post('/', async (req, res) => {
  const { monto, simbolo, descripcion } = req.body;
  if (monto == null || isNaN(Number(monto)) || Number(monto) <= 0)
    return res.status(400).json({ error: 'Monto inválido' });
  if (!simbolo || typeof simbolo !== 'string' || simbolo.trim() === '')
    return res.status(400).json({ error: 'Símbolo requerido' });
  try {
    const activo = req.body.activo === true;
    if (activo) {
      try {
        const paymentTableExists = await hasPaymentsTable(sql);
        const [, created, updatedOrders] = await sql.transaction((tx) => [
          tx`UPDATE tasas_cambio SET activo = FALSE WHERE activo = TRUE`,
          tx`
          INSERT INTO tasas_cambio (monto, simbolo, descripcion, creado_en, activo)
          VALUES (${Number(monto)}, ${simbolo.trim()}, ${
          descripcion || null
        }, NOW(), TRUE) RETURNING *
          `,
          buildPendingUnpaidOrderRateUpdateQuery(tx, {
            rate: Number(monto),
            hasPaymentTable: paymentTableExists,
          }),
        ]);
        return res.status(201).json({
          ...created[0],
          pedidos_actualizados_tasa: updatedOrders.length,
        });
      } catch (e) {
        // If another concurrent request created the active rate, return that existing active row
        const msg = e && e.message ? e.message : '';
        if (msg.includes('idx_tasas_cambio_activo_true') || msg.includes('unique')) {
          try {
            const existing =
              await sql`SELECT * FROM tasas_cambio WHERE simbolo = ${simbolo.trim()} AND activo = TRUE ORDER BY id DESC`;
            if (existing && existing.length > 0) {
              return res.status(200).json(existing[0]);
            }
          } catch (fetchErr) {
            console.error(
              'Error fetching existing active tasa after unique conflict:',
              fetchErr && fetchErr.message ? fetchErr.message : fetchErr
            );
          }
        }
        throw e;
      }
    } else {
      const created = await sql`
        INSERT INTO tasas_cambio (monto, simbolo, descripcion, creado_en, activo)
        VALUES (${Number(monto)}, ${simbolo.trim()}, ${
        descripcion || null
      }, NOW(), FALSE) RETURNING *
      `;
      return res.status(201).json(created[0]);
    }
  } catch (err) {
    console.error('Error creando tasa:', err && err.message ? err.message : err);
    // Return detailed message to help frontend debug (can be softened later)
    return res.status(500).json({ error: err && err.message ? err.message : 'Error creando tasa' });
  }
});

// Actualizar una tasa
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { monto, simbolo, descripcion } = req.body;
  if (monto != null && (isNaN(Number(monto)) || Number(monto) <= 0))
    return res.status(400).json({ error: 'Monto inválido' });
  if (simbolo != null && (typeof simbolo !== 'string' || simbolo.trim() === ''))
    return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const activo = req.body.activo;
    if (activo === true) {
      const paymentTableExists = await hasPaymentsTable(sql);
      const [, updated, updatedOrders] = await sql.transaction((tx) => [
        tx`
          UPDATE tasas_cambio
          SET activo = FALSE
          WHERE activo = TRUE
            AND EXISTS (SELECT 1 FROM tasas_cambio WHERE id = ${id})
        `,
        tx`
          UPDATE tasas_cambio
          SET monto = COALESCE(${monto}::numeric, monto), simbolo = COALESCE(${simbolo}, simbolo), descripcion = COALESCE(${descripcion}, descripcion), actualizado_en = NOW(), activo = TRUE
          WHERE id = ${id}
          RETURNING *
        `,
        buildPendingUnpaidOrderRateUpdateQuery(tx, {
          hasPaymentTable: paymentTableExists,
          activeRateId: id,
        }),
      ]);
      if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
      return res.json({
        ...updated[0],
        pedidos_actualizados_tasa: updatedOrders.length,
      });
    } else if (activo === false) {
      // Simple update que asegura activo = false
      const updated = await sql`
        UPDATE tasas_cambio
        SET monto = COALESCE(${monto}::numeric, monto), simbolo = COALESCE(${simbolo}, simbolo), descripcion = COALESCE(${descripcion}, descripcion), actualizado_en = NOW(), activo = FALSE
        WHERE id = ${id}
        RETURNING *
      `;
      if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
      return res.json(updated[0]);
    } else {
      const paymentTableExists = await hasPaymentsTable(sql);
      const [updated, updatedOrders] = await sql.transaction((tx) => [
        tx`
          UPDATE tasas_cambio
          SET monto = COALESCE(${monto}::numeric, monto), simbolo = COALESCE(${simbolo}, simbolo), descripcion = COALESCE(${descripcion}, descripcion), actualizado_en = NOW()
          WHERE id = ${id}
          RETURNING *
        `,
        buildPendingUnpaidOrderRateUpdateQuery(tx, {
          hasPaymentTable: paymentTableExists,
          activeRateId: id,
        }),
      ]);
      if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
      if (updated[0].activo) {
        return res.json({
          ...updated[0],
          pedidos_actualizados_tasa: updatedOrders.length,
        });
      }
      return res.json(updated[0]);
    }
  } catch (err) {
    console.error('Error actualizando tasa:', err && err.message ? err.message : err);
    return res
      .status(500)
      .json({ error: err && err.message ? err.message : 'Error actualizando tasa' });
  }
});

// Eliminar una tasa
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const deleted = await sql`DELETE FROM tasas_cambio WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json({ success: true, deleted: deleted[0] });
  } catch (err) {
    console.error('Error eliminando tasa:', err && err.message ? err.message : err);
    return res
      .status(500)
      .json({ error: err && err.message ? err.message : 'Error eliminando tasa' });
  }
});

module.exports = router;
