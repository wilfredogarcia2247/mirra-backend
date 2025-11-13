const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarPago(body) {
  if (!body.pedido_venta_id || isNaN(Number(body.pedido_venta_id))) return 'ID de pedido de venta requerido';
  if (!body.forma_pago_id || isNaN(Number(body.forma_pago_id))) return 'ID de forma de pago requerido';
  if (!body.banco_id || isNaN(Number(body.banco_id))) return 'ID de banco requerido';
  if (!body.monto || isNaN(Number(body.monto))) return 'Monto requerido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    // Devolver pagos enriquecidos con banco y forma de pago
    const result = await sql`
      SELECT p.*, b.nombre AS banco_nombre, b.moneda AS banco_moneda,
             f.nombre AS forma_nombre, bf.detalles AS forma_detalles
      FROM pagos p
      LEFT JOIN bancos b ON b.id = p.banco_id
      LEFT JOIN formas_pago f ON f.id = p.forma_pago_id
      LEFT JOIN banco_formas_pago bf ON bf.banco_id = p.banco_id AND bf.forma_pago_id = p.forma_pago_id
      ORDER BY p.fecha DESC
    `;
    const enriched = (result || []).map(r => ({
      id: r.id,
      pedido_venta_id: r.pedido_venta_id,
      forma_pago_id: r.forma_pago_id,
      banco_id: r.banco_id,
      monto: r.monto,
      referencia: r.referencia,
      fecha_transaccion: r.fecha_transaccion,
      fecha: r.fecha,
      tasa: r.tasa,
      tasa_simbolo: r.tasa_simbolo,
      banco: r.banco_id ? { id: r.banco_id, nombre: r.banco_nombre, moneda: r.banco_moneda } : null,
      forma_pago: r.forma_pago_id ? { id: r.forma_pago_id, nombre: r.forma_nombre, detalles: r.forma_detalles } : null
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarPago(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { pedido_venta_id, forma_pago_id, banco_id, monto } = req.body;
    // Determinar tasa y simbolo: priorizar moneda del banco y su tasa activa,
    // fallback a detalles específicos por banco+forma y finalmente a cualquier tasa activa
    let tasaVal = null;
    let tasaSimbolo = null;
    try {
      if (banco_id != null) {
        try {
          const bancoRow = await sql`SELECT moneda FROM bancos WHERE id = ${banco_id}`;
          const moneda = bancoRow && bancoRow[0] && bancoRow[0].moneda ? bancoRow[0].moneda : null;
          if (moneda) {
            const tasaRow = await sql`SELECT monto FROM tasas_cambio WHERE simbolo = ${moneda} LIMIT 1`;
            if (tasaRow && tasaRow[0]) {
              tasaVal = tasaRow[0].monto;
              tasaSimbolo = moneda;
            }
          }
        } catch (e) {}

        // Si no se obtuvo tasa desde la moneda del banco, verificar detalles por banco+forma
        if (tasaVal == null && forma_pago_id != null) {
          try {
            const bf = await sql`SELECT detalles FROM banco_formas_pago WHERE banco_id = ${banco_id} AND forma_pago_id = ${forma_pago_id} LIMIT 1`;
            if (bf && bf[0] && bf[0].detalles) {
              const det = bf[0].detalles;
              if (det.tasa != null) tasaVal = det.tasa;
              if (det.tasa_simbolo && !tasaSimbolo) tasaSimbolo = det.tasa_simbolo;
              else if (det.simbolo && !tasaSimbolo) tasaSimbolo = det.simbolo;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Fallback a cualquier tasa activa si aún no tenemos una
    if (tasaVal == null) {
      try {
        const anyT = await sql`SELECT monto, simbolo FROM tasas_cambio WHERE activo = TRUE LIMIT 1`;
        if (anyT && anyT[0]) {
          tasaVal = anyT[0].monto;
          tasaSimbolo = anyT[0].simbolo;
        }
      } catch (e) {}
    }

    const result = await sql`INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo) VALUES (${pedido_venta_id}, ${forma_pago_id}, ${banco_id}, ${monto}, ${req.body.referencia || null}, ${req.body.fecha_transaccion || null}, NOW(), ${tasaVal || null}, ${tasaSimbolo || null}) RETURNING *`;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
