const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const {
  maskPersonalNumber,
  summarizeCouponHistory,
} = require('../services/influencerCommissions');
const { resolveImageUrl } = require('./imagenes');
const sql = neon(process.env.DATABASE_URL);

const TIPOS_COLABORADOR = new Set(['trabajador', 'influencer', 'colaborador']);

function requireAdmin(req, res) {
  if (req.user?.rol !== 'admin') {
    res.status(403).json({ error: 'Acceso solo para administradores' });
    return false;
  }
  return true;
}

function parseOptionalId(value) {
  if (value === '' || value == null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateColaborador(body) {
  if (!String(body.nombre || '').trim()) return 'El nombre del colaborador es requerido';
  if (!TIPOS_COLABORADOR.has(body.tipo)) return 'Tipo de colaborador inválido';
  if (body.tipo === 'influencer' && parseOptionalId(body.usuario_id) == null) {
    return 'Vincula el influencer con una cuenta de usuario';
  }
  const porcentaje = body.porcentaje_comision == null || body.porcentaje_comision === ''
    ? (body.tipo === 'influencer' ? 10 : 0)
    : Number(body.porcentaje_comision);
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    return 'La comisión debe estar entre 0 y 100 por ciento';
  }
  return null;
}

async function validateInfluencerUser(usuarioId, tipo, colaboradorId = null) {
  if (tipo !== 'influencer' || usuarioId == null) return null;
  const users = await sql`
    SELECT id FROM usuarios
    WHERE id = ${usuarioId} AND LOWER(rol) = 'influencer'
    LIMIT 1
  `;
  if (!users.length) return 'La cuenta vinculada debe tener el rol influencer';
  const linked = await sql`
    SELECT id FROM colaboradores
    WHERE usuario_id = ${usuarioId}
      AND tipo = 'influencer'
      AND (${colaboradorId}::int IS NULL OR id <> ${colaboradorId}::int)
    LIMIT 1
  `;
  if (linked.length) return 'La cuenta ya está vinculada a otro influencer';
  return null;
}

function validateCupon(body) {
  const codigo = String(body.codigo || '').trim();
  const descuento = Number(body.descuento_porcentaje);
  if (!codigo) return 'El código del cupón es requerido';
  if (!Number.isFinite(descuento) || descuento <= 0 || descuento > 100) {
    return 'El descuento debe ser mayor que 0 y menor o igual a 100';
  }
  const colaboradorId = parseOptionalId(body.colaborador_id);
  if (Number.isNaN(colaboradorId)) return 'Colaborador inválido';
  const usoMaximo = body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo);
  if (usoMaximo !== null && (!Number.isInteger(usoMaximo) || usoMaximo < 1)) {
    return 'El uso máximo debe ser un entero positivo o ilimitado';
  }
  if (body.fecha_inicio && Number.isNaN(Date.parse(body.fecha_inicio))) return 'Fecha de inicio inválida';
  if (body.fecha_fin && Number.isNaN(Date.parse(body.fecha_fin))) return 'Fecha de fin inválida';
  if (body.fecha_inicio && body.fecha_fin && Date.parse(body.fecha_fin) < Date.parse(body.fecha_inicio)) {
    return 'La fecha fin no puede ser anterior a la fecha inicio';
  }
  return null;
}

router.get('/colaboradores', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await sql`
      SELECT c.*, u.nombre AS usuario_nombre,
             COALESCE(metrics.pedidos, 0)::int AS pedidos_comisionables,
             COALESCE(metrics.base_comisionable, 0)::numeric AS base_comisionable,
             COALESCE(metrics.comision_generada, 0)::numeric AS comision_generada,
             COALESCE(payouts.comision_pagada, 0)::numeric AS comision_pagada,
             GREATEST(0, COALESCE(metrics.comision_generada, 0) - COALESCE(payouts.comision_pagada, 0))::numeric AS saldo_pendiente
      FROM colaboradores c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      LEFT JOIN (
        SELECT coupons.colaborador_id,
          COUNT(*)::int AS pedidos,
          COALESCE(SUM(cu.base_comisionable), 0)::numeric AS base_comisionable,
          COALESCE(SUM(cu.comision_monto), 0)::numeric AS comision_generada
        FROM cupon_usos cu
        JOIN cupones coupons ON coupons.id = cu.cupon_id
        JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
        WHERE cu.pedido_pagado_en IS NOT NULL
          AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
        GROUP BY coupons.colaborador_id
      ) metrics ON metrics.colaborador_id = c.id
      LEFT JOIN (
        SELECT colaborador_id, COALESCE(SUM(monto), 0)::numeric AS comision_pagada
        FROM influencer_comision_pagos GROUP BY colaborador_id
      ) payouts ON payouts.colaborador_id = c.id
      ORDER BY c.activo DESC, c.nombre ASC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando colaboradores:', error.message || error);
    return res.status(500).json({ error: 'Error listando colaboradores' });
  }
});

router.get('/usuarios-influencer', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await sql`
      SELECT id, nombre, email
      FROM usuarios
      WHERE LOWER(rol) = 'influencer'
      ORDER BY nombre ASC, email ASC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando cuentas influencer:', error.message || error);
    return res.status(500).json({ error: 'Error listando cuentas influencer' });
  }
});

router.get('/colaboradores/:id/comisiones-pagos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const colaboradorId = Number(req.params.id);
  const fechaCorte = req.query.fecha_corte ? String(req.query.fecha_corte) : new Date().toISOString().slice(0, 10);
  if (!Number.isInteger(colaboradorId) || colaboradorId < 1) return res.status(400).json({ error: 'ID inválido' });
  if (!isValidDateOnly(fechaCorte)) return res.status(400).json({ error: 'Fecha de corte inválida' });
  try {
    const [paymentsRaw, generatedRows, paidRows] = await Promise.all([
      sql`
        SELECT id, monto, fecha_corte, fecha_pago, referencia, comprobante_url, comprobante_key, observaciones, creado_en
        FROM influencer_comision_pagos
        WHERE colaborador_id = ${colaboradorId}
        ORDER BY fecha_corte DESC, fecha_pago DESC, id DESC
      `,
      sql`
        SELECT COALESCE(SUM(cu.comision_monto), 0)::numeric AS total
        FROM cupon_usos cu
        JOIN cupones c ON c.id = cu.cupon_id
        JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
        WHERE c.colaborador_id = ${colaboradorId}
          AND cu.pedido_pagado_en IS NOT NULL
          AND cu.pedido_pagado_en < (${fechaCorte}::date + INTERVAL '1 day')
          AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
      `,
      sql`
        SELECT COALESCE(SUM(monto), 0)::numeric AS total
        FROM influencer_comision_pagos
        WHERE colaborador_id = ${colaboradorId} AND fecha_corte <= ${fechaCorte}::date
      `,
    ]);
    const generado = Number(generatedRows[0]?.total || 0);
    const pagado = Number(paidRows[0]?.total || 0);
    const payments = await Promise.all((paymentsRaw || []).map(async (payment) => ({
      ...payment,
      comprobante_url: payment.comprobante_key
        ? await resolveImageUrl(payment.comprobante_key)
        : payment.comprobante_url,
    })));
    return res.json({ pagos: payments, resumen: { fecha_corte: fechaCorte, generado, pagado, disponible: Math.max(0, Number((generado - pagado).toFixed(2))) } });
  } catch (error) {
    console.error('Error consultando pagos al influencer:', error.message || error);
    return res.status(500).json({ error: 'Error consultando pagos al influencer' });
  }
});

router.post('/colaboradores/:id/comisiones-pagos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const colaboradorId = Number(req.params.id);
  const referencia = String(req.body?.referencia || '').trim();
  const comprobanteKey = String(req.body?.comprobante_key || '').trim();
  const observaciones = String(req.body?.observaciones || '').trim() || null;
  const fechaCorte = String(req.body?.fecha_corte || '');
  if (!Number.isInteger(colaboradorId) || colaboradorId < 1) return res.status(400).json({ error: 'ID inválido' });
  if (!isValidDateOnly(fechaCorte)) return res.status(400).json({ error: 'Fecha de corte inválida' });
  if (!referencia) return res.status(400).json({ error: 'La referencia del pago es obligatoria' });
  if (!comprobanteKey) return res.status(400).json({ error: 'El comprobante de pago es obligatorio' });

  try {
    await sql`BEGIN`;
    try {
      const collaborator = await sql`
        SELECT id FROM colaboradores
        WHERE id = ${colaboradorId} AND tipo = 'influencer'
        FOR UPDATE
      `;
      if (!collaborator.length) {
        await sql`ROLLBACK`;
        return res.status(404).json({ error: 'Influencer no encontrado' });
      }
      const existingCutoff = await sql`
        SELECT id FROM influencer_comision_pagos
        WHERE colaborador_id = ${colaboradorId} AND fecha_corte = ${fechaCorte}::date
        LIMIT 1
      `;
      if (existingCutoff.length) {
        await sql`ROLLBACK`;
        return res.status(409).json({ error: 'Ya existe una liquidación para esta fecha de corte' });
      }
      const [generatedRows, paidRows] = await Promise.all([
        sql`
          SELECT COALESCE(SUM(cu.comision_monto), 0)::numeric AS total
          FROM cupon_usos cu
          JOIN cupones c ON c.id = cu.cupon_id
          JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
          WHERE c.colaborador_id = ${colaboradorId}
            AND cu.pedido_pagado_en IS NOT NULL
            AND cu.pedido_pagado_en < (${fechaCorte}::date + INTERVAL '1 day')
            AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
        `,
        sql`SELECT COALESCE(SUM(monto), 0)::numeric AS total FROM influencer_comision_pagos WHERE colaborador_id = ${colaboradorId} AND fecha_corte <= ${fechaCorte}::date`,
      ]);
      const generated = Number(generatedRows[0]?.total || 0);
      const alreadyPaid = Number(paidRows[0]?.total || 0);
      const outstanding = Math.max(0, Number((generated - alreadyPaid).toFixed(2)));
      if (outstanding <= 0) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'No hay comisiones pendientes hasta esa fecha de corte' });
      }
      const inserted = await sql`
        INSERT INTO influencer_comision_pagos (colaborador_id, monto, fecha_corte, fecha_pago, referencia, comprobante_key, observaciones, usuario_admin_id)
        VALUES (${colaboradorId}, ${outstanding}, ${fechaCorte}::date, NOW(), ${referencia}, ${comprobanteKey}, ${observaciones}, ${Number(req.user?.id) || null})
        RETURNING *
      `;

      // Al liquidar el corte, los cupones cuyas ventas entraron en este pago se
      // desactivan: ya quedaron cobrados y no deben seguir sumando a futuras compras.
      // El admin crea un código nuevo si el influencer sigue vendiendo.
      const cuponesDelCorte = await sql`
        SELECT DISTINCT c.id, c.codigo
        FROM cupon_usos cu
        JOIN cupones c ON c.id = cu.cupon_id
        JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
        WHERE c.colaborador_id = ${colaboradorId}
          AND c.activo = 1
          AND cu.pedido_pagado_en IS NOT NULL
          AND cu.pedido_pagado_en < (${fechaCorte}::date + INTERVAL '1 day')
          AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
      `;
      const cuponIds = (cuponesDelCorte || []).map((c) => c.id);
      if (cuponIds.length) {
        await sql`UPDATE cupones SET activo = 0, actualizado_en = NOW() WHERE id = ANY(${cuponIds})`;
      }

      await sql`COMMIT`;
      const payment = inserted[0];
      payment.comprobante_url = await resolveImageUrl(payment.comprobante_key);
      payment.cupones_desactivados = (cuponesDelCorte || []).map((c) => c.codigo);
      return res.status(201).json(payment);
    } catch (transactionError) {
      try { await sql`ROLLBACK`; } catch (rollbackError) { }
      throw transactionError;
    }
  } catch (error) {
    console.error('Error registrando pago al influencer:', error.message || error);
    return res.status(500).json({ error: 'Error registrando pago al influencer' });
  }
});

router.post('/colaboradores', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const error = validateColaborador(req.body || {});
  if (error) return res.status(400).json({ error });
  const body = req.body || {};
  const usuarioId = parseOptionalId(body.usuario_id);
  if (Number.isNaN(usuarioId)) return res.status(400).json({ error: 'Usuario inválido' });
  try {
    const usuarioError = await validateInfluencerUser(usuarioId, body.tipo);
    if (usuarioError) return res.status(400).json({ error: usuarioError });
    const rows = await sql`
      INSERT INTO colaboradores (nombre, telefono, email, instagram, tiktok, youtube, tipo, usuario_id, observaciones, activo, porcentaje_comision)
      VALUES (${String(body.nombre).trim()}, ${body.telefono || null}, ${body.email || null}, ${body.instagram || null}, ${body.tiktok || null}, ${body.youtube || null}, ${body.tipo}, ${usuarioId}, ${body.observaciones || null}, ${body.activo !== false ? 1 : 0}, ${body.porcentaje_comision == null || body.porcentaje_comision === '' ? (body.tipo === 'influencer' ? 10 : 0) : Number(body.porcentaje_comision)})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error creando colaborador' });
  }
});

router.put('/colaboradores/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  const error = validateColaborador(req.body || {});
  if (error) return res.status(400).json({ error });
  const body = req.body || {};
  const usuarioId = parseOptionalId(body.usuario_id);
  if (Number.isNaN(usuarioId)) return res.status(400).json({ error: 'Usuario inválido' });
  try {
    const usuarioError = await validateInfluencerUser(usuarioId, body.tipo, id);
    if (usuarioError) return res.status(400).json({ error: usuarioError });
    const rows = await sql`
      UPDATE colaboradores SET nombre = ${String(body.nombre).trim()}, telefono = ${body.telefono || null}, email = ${body.email || null}, instagram = ${body.instagram || null}, tiktok = ${body.tiktok || null}, youtube = ${body.youtube || null}, tipo = ${body.tipo}, usuario_id = ${usuarioId}, observaciones = ${body.observaciones || null}, activo = ${body.activo !== false ? 1 : 0}, porcentaje_comision = ${body.porcentaje_comision == null || body.porcentaje_comision === '' ? (body.tipo === 'influencer' ? 10 : 0) : Number(body.porcentaje_comision)}, actualizado_en = NOW()
      WHERE id = ${id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Colaborador no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando colaborador' });
  }
});

router.patch('/colaboradores/:id/estado', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`UPDATE colaboradores SET activo = ${req.body?.activo === true ? 1 : 0}, actualizado_en = NOW() WHERE id = ${id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Colaborador no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando estado del colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando colaborador' });
  }
});

router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await sql`
      SELECT c.*,
             COALESCE(cu.usos, 0)::int AS usos_registrados,
             COALESCE(cu.descuento_total, 0)::numeric AS descuento_total,
             col.nombre AS colaborador_nombre
      FROM cupones c
      LEFT JOIN colaboradores col ON col.id = c.colaborador_id
      LEFT JOIN (
        SELECT cupon_id,
               COUNT(*)::int AS usos,
               COALESCE(SUM(descuento_aplicado), 0)::numeric AS descuento_total
        FROM cupon_usos GROUP BY cupon_id
      ) cu ON cu.cupon_id = c.id
      ORDER BY c.creado_en DESC, c.id DESC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando cupones:', error.message || error);
    return res.status(500).json({ error: 'Error listando cupones' });
  }
});

router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  const error = validateCupon(body);
  if (error) return res.status(400).json({ error });
  try {
    const rows = await sql`
      INSERT INTO cupones (codigo, descuento_porcentaje, colaborador_id, descripcion, fecha_inicio, fecha_fin, uso_maximo, activo, es_global)
      VALUES (${String(body.codigo).trim().toUpperCase()}, ${Number(body.descuento_porcentaje)}, ${parseOptionalId(body.colaborador_id)}, ${body.descripcion || null}, COALESCE(${body.fecha_inicio || null}::timestamptz, NOW()), ${body.fecha_fin || null}, ${body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo)}, ${body.activo !== false ? 1 : 0}, ${body.es_global === true ? 1 : 0})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('cupones_codigo_key')) return res.status(409).json({ error: 'Ya existe un cupón con ese código' });
    console.error('Error creando cupón:', err.message || err);
    return res.status(500).json({ error: 'Error creando cupón' });
  }
});

router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  const body = req.body || {};
  const error = validateCupon(body);
  if (error) return res.status(400).json({ error });
  try {
    const rows = await sql`
      UPDATE cupones SET codigo = ${String(body.codigo).trim().toUpperCase()}, descuento_porcentaje = ${Number(body.descuento_porcentaje)}, colaborador_id = ${parseOptionalId(body.colaborador_id)}, descripcion = ${body.descripcion || null}, fecha_inicio = COALESCE(${body.fecha_inicio || null}::timestamptz, NOW()), fecha_fin = ${body.fecha_fin || null}, uso_maximo = ${body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo)}, activo = ${body.activo !== false ? 1 : 0}, es_global = ${body.es_global === true ? 1 : 0}, actualizado_en = NOW()
      WHERE id = ${id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Cupón no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('cupones_codigo_key')) return res.status(409).json({ error: 'Ya existe un cupón con ese código' });
    console.error('Error actualizando cupón:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando cupón' });
  }
});

router.patch('/:id/estado', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`UPDATE cupones SET activo = ${req.body?.activo === true ? 1 : 0}, actualizado_en = NOW() WHERE id = ${id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Cupón no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando estado del cupón:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando cupón' });
  }
});

router.get('/influencer/dashboard', influencerDashboard);

router.get('/:id/usos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`
      SELECT cu.*, pv.nombre_cliente, pv.fecha AS pedido_fecha
      FROM cupon_usos cu
      LEFT JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
      WHERE cu.cupon_id = ${id}
      ORDER BY cu.usado_en DESC
    `;
    return res.json(rows || []);
  } catch (err) {
    console.error('Error consultando usos de cupón:', err.message || err);
    return res.status(500).json({ error: 'Error consultando usos del cupón' });
  }
});

async function influencerDashboard(req, res) {
  const usuarioId = Number(req.user?.id);
  if (!Number.isInteger(usuarioId) || usuarioId < 1) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  const fechaInicio = req.query.fecha_inicio ? String(req.query.fecha_inicio) : null;
  const fechaFin = req.query.fecha_fin ? String(req.query.fecha_fin) : null;
  const isValidDate = (value) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!isValidDate(fechaInicio) || !isValidDate(fechaFin)) {
    return res.status(400).json({ error: 'Formato de fecha inválido' });
  }
  if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
    return res.status(400).json({ error: 'La fecha inicial no puede ser posterior a la fecha final' });
  }

  try {
    const colaboradores = await sql`
      SELECT id, nombre, porcentaje_comision
      FROM colaboradores
      WHERE usuario_id = ${usuarioId} AND tipo = 'influencer' AND activo = 1
      LIMIT 1
    `;
    if (!colaboradores.length) {
      return res.status(404).json({ error: 'No hay un perfil de influencer activo vinculado a este usuario' });
    }
    const colaborador = colaboradores[0];
    const [cuponRows, orderRows, payoutRows, paymentHistoryRows] = await Promise.all([
      sql`
        SELECT c.id, c.codigo, c.descuento_porcentaje, c.activo,
          c.fecha_inicio, c.fecha_fin, c.uso_actual, c.uso_maximo,
          COALESCE(col.porcentaje_comision, 10)::numeric AS porcentaje_comision
        FROM cupones c
        LEFT JOIN colaboradores col ON col.id = c.colaborador_id
        WHERE colaborador_id = ${colaborador.id}
        ORDER BY codigo ASC
      `,
      sql`
        WITH lineas AS (
          SELECT pvp.pedido_venta_id,
            SUM(pvp.cantidad * COALESCE(pvp.precio_venta, prod.precio_venta, 0)) AS subtotal,
            JSON_AGG(JSON_BUILD_OBJECT(
              'nombre', COALESCE(pvp.nombre_producto, pvp.formula_nombre, prod.nombre, 'Producto'),
              'cantidad', pvp.cantidad,
              'precio_unitario', COALESCE(pvp.precio_venta, prod.precio_venta, 0),
              'subtotal', pvp.cantidad * COALESCE(pvp.precio_venta, prod.precio_venta, 0)
            ) ORDER BY pvp.id) AS productos
          FROM pedido_venta_productos pvp
          LEFT JOIN productos prod ON prod.id = pvp.producto_id
          GROUP BY pvp.pedido_venta_id
        )
        SELECT cu.id AS uso_id, pv.id AS pedido_venta_id, pv.fecha AS pedido_fecha,
          pv.estado, pv.nombre_cliente, pv.cedula, pv.telefono,
          COALESCE(l.productos, '[]'::json) AS productos,
          ROUND(COALESCE(l.subtotal, 0), 2) AS subtotal_productos,
          cu.recargo_snapshot AS recargos,
          COALESCE(pv.descuento_cupon, cu.descuento_aplicado, 0) AS descuento_cupon,
          cu.total_pedido_snapshot AS total_usd,
          cu.tasa_cambio_snapshot AS tasa_cambio_monto,
          cu.iva_snapshot AS iva,
          cu.base_comisionable,
          cu.comision_monto,
          cu.pedido_pagado_en,
          c.id AS cupon_id, c.codigo, c.descuento_porcentaje,
          COALESCE(cu.porcentaje_comision, col.porcentaje_comision, 10) AS porcentaje_comision
        FROM cupon_usos cu
        JOIN cupones c ON c.id = cu.cupon_id
        JOIN colaboradores col ON col.id = c.colaborador_id
        JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
        LEFT JOIN lineas l ON l.pedido_venta_id = pv.id
        WHERE c.colaborador_id = ${colaborador.id}
          AND cu.pedido_pagado_en IS NOT NULL
          AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
          AND (${fechaInicio}::date IS NULL OR pv.fecha::date >= ${fechaInicio}::date)
          AND (${fechaFin}::date IS NULL OR pv.fecha::date <= ${fechaFin}::date)
        ORDER BY pv.fecha DESC, pv.id DESC
      `,
      sql`SELECT COALESCE(SUM(monto), 0)::numeric AS total FROM influencer_comision_pagos WHERE colaborador_id = ${colaborador.id}`,
      sql`
        SELECT id, monto, fecha_corte, fecha_pago, referencia, comprobante_url, comprobante_key
        FROM influencer_comision_pagos
        WHERE colaborador_id = ${colaborador.id}
        ORDER BY fecha_pago DESC, id DESC
        LIMIT 50
      `,
    ]);
    const usos = (orderRows || []).map((order) => {
      const totalUsd = Number(order.total_usd || 0);
      const porcentajeComision = Number(order.porcentaje_comision || 0);
      return {
        ...order,
        cedula: maskPersonalNumber(order.cedula, 2),
        telefono: maskPersonalNumber(order.telefono, 4),
        total_usd: totalUsd,
        recargos: Number(order.recargos || 0),
        total_bs: order.tasa_cambio_monto == null ? null : Number((totalUsd * Number(order.tasa_cambio_monto)).toFixed(2)),
        base_comisionable: Number(order.base_comisionable || 0),
        iva: Number(order.iva || 0),
        porcentaje_comision: porcentajeComision,
        comision_monto: Number(order.comision_monto || 0),
        pagado: true,
        cancelado: false,
      };
    });
    const comisionGenerada = Number(usos.reduce((sum, order) => sum + order.comision_monto, 0).toFixed(2));
    const comisionPagada = Number(payoutRows[0]?.total || 0);
    const pagos = await Promise.all((paymentHistoryRows || []).map(async (payment) => ({
      ...payment,
      comprobante_url: payment.comprobante_key
        ? await resolveImageUrl(payment.comprobante_key)
        : payment.comprobante_url,
    })));
    return res.json({
      colaborador: {
        nombre: colaborador.nombre,
        porcentaje_comision: Number(colaborador.porcentaje_comision || 0),
      },
      resumen: {
        pedidos: usos.length,
        pedidos_cancelados: 0,
        base_comisionable: Number(usos.reduce((sum, order) => sum + order.base_comisionable, 0).toFixed(2)),
        comision_estimada: comisionGenerada,
        comision_generada: comisionGenerada,
        comision_pagada: comisionPagada,
        saldo_pendiente: Math.max(0, Number((comisionGenerada - comisionPagada).toFixed(2))),
      },
      pagos,
      cupones: summarizeCouponHistory(cuponRows, usos),
      usos,
    });
  } catch (error) {
    console.error('Error consultando métricas del influencer:', error.message || error);
    return res.status(500).json({ error: 'No se pudieron cargar las métricas' });
  }
}

module.exports = router;