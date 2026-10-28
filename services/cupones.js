const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const CODIGO_MAX_LEN = 64;

function normalizeCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase().slice(0, CODIGO_MAX_LEN);
}

function roundCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function mapCupon(row) {
  return {
    id: Number(row.id),
    codigo: row.codigo,
    descuento_porcentaje: Number(row.descuento_porcentaje),
    descripcion: row.descripcion,
    es_global: Boolean(row.es_global),
    uso_actual: Number(row.uso_actual || 0),
    uso_maximo: row.uso_maximo == null ? null : Number(row.uso_maximo),
    colaborador_nombre: row.colaborador_nombre || null,
    colaborador_id: row.colaborador_id == null ? null : Number(row.colaborador_id),
    colaborador_tipo: row.colaborador_tipo || null,
    porcentaje_comision: Number(row.porcentaje_comision || 0),
  };
}

let schemaReady = null;

/**
 * Garantiza que `cupon_usos` tenga el esquema esperado por el canje
 * (columnas `descuento_aplicado`/`cliente_id` e índice único por pedido).
 * Necesario porque instalaciones previas de la tabla usaban el nombre
 * `descuentoaplicado` y no tenían el índice único.
 */
async function ensureCuponesSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS descuento_aplicado NUMERIC(12, 2)`;
        await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS cliente_id INTEGER`;

        // Backfill desde la columna legacy (sin guion bajo) si existe
        const legacy = await sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'cupon_usos' AND column_name = 'descuentoaplicado'
        `;
        if (legacy && legacy.length) {
          await sql`
            UPDATE cupon_usos
            SET descuento_aplicado = descuentoaplicado
            WHERE descuento_aplicado IS NULL AND descuentoaplicado IS NOT NULL
          `;
          // La columna legacy (NOT NULL sin default) estorba el canje: se elimina tras el backfill
          await sql`ALTER TABLE cupon_usos DROP COLUMN IF EXISTS descuentoaplicado`;
        }

        // `usado_en` puede haber quedado como timestamp sin zona horaria (valores en UTC).
        // La conversión solo aplica mientras la columna no tenga zona horaria: repetirla
        // desplazaría los instantes ya corregidos.
        const usadoEn = await sql`
          SELECT data_type FROM information_schema.columns
          WHERE table_name = 'cupon_usos' AND column_name = 'usado_en'
        `;
        if (usadoEn && usadoEn[0] && usadoEn[0].data_type === 'timestamp without time zone') {
          await sql`
            ALTER TABLE cupon_usos
            ALTER COLUMN usado_en TYPE TIMESTAMPTZ
            USING usado_en AT TIME ZONE 'UTC'
          `;
          await sql`ALTER TABLE cupon_usos ALTER COLUMN usado_en SET DEFAULT NOW()`;
          await sql`ALTER TABLE cupon_usos ALTER COLUMN usado_en SET NOT NULL`;
        }

        // El índice único permite el ON CONFLICT del canje; se limpian duplicados previos
        await sql`
          DELETE FROM cupon_usos a USING cupon_usos b
          WHERE a.id > b.id
            AND a.cupon_id = b.cupon_id
            AND a.pedido_venta_id = b.pedido_venta_id
        `;
        await sql`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cupon_usos_cupon_pedido
          ON cupon_usos (cupon_id, pedido_venta_id)
        `;
      } catch (error) {
        console.error('Error verificando esquema de cupones:', error.message || error);
      }
    })();
  }
  return schemaReady;
}

/**
 * Busca un cupón por código y devuelve { ok: true, cupon } o { ok: false, error }.
 * Un cupón es válido si está activo, dentro de su ventana de fechas y tiene usos disponibles.
 */
async function validarCupon(codigo) {
  const cod = normalizeCodigo(codigo);
  if (!cod) return { ok: false, error: 'Ingresa el código del cupón', status: 400 };

  try {
    const rows = await sql`
            SELECT c.id, c.codigo, c.descuento_porcentaje, c.descripcion, c.es_global,
              c.uso_actual, c.uso_maximo, col.nombre AS colaborador_nombre,
              col.id AS colaborador_id, col.tipo AS colaborador_tipo,
              col.porcentaje_comision
      FROM cupones c
      LEFT JOIN colaboradores col ON col.id = c.colaborador_id
      WHERE UPPER(c.codigo) = ${cod}
        AND c.activo = 1
        AND c.fecha_inicio <= NOW()
        AND (c.fecha_fin IS NULL OR c.fecha_fin >= NOW())
        AND (c.uso_maximo IS NULL OR c.uso_actual < c.uso_maximo)
      LIMIT 1
    `;
    if (!rows || !rows.length) {
      return { ok: false, error: 'Cupón inválido, vencido o sin usos disponibles', status: 404 };
    }
    return { ok: true, cupon: mapCupon(rows[0]) };
  } catch (error) {
    console.error('Error validando cupón:', error.message || error);
    return { ok: false, error: 'No se pudo validar el cupón', status: 500 };
  }
}

/**
 * Calcula el monto de descuento sobre un total base.
 */
function calcularDescuento(totalBase, descuentoPorcentaje) {
  const base = Number(totalBase) || 0;
  const pct = Number(descuentoPorcentaje) || 0;
  if (base <= 0 || pct <= 0) return 0;
  return roundCurrency(base * (pct / 100));
}

/**
 * Registra el canje del cupón para un pedido: inserta el uso y consume una unidad
 * del cupo disponible. El UPDATE es condicional para no sobrepasar `uso_maximo`
 * cuando dos pedidos validan el mismo cupón a la vez.
 * Devuelve { ok: true } o { ok: false, error }.
 */
async function registrarUsoCupon(cupon, pedidoVentaId, descuentoAplicado, clienteId, comision = {}) {
  const cuponId = Number(cupon?.id);
  const pedidoId = Number(pedidoVentaId);
  if (!Number.isInteger(cuponId) || cuponId < 1) {
    return { ok: false, error: 'Cupón inválido' };
  }
  if (!Number.isInteger(pedidoId) || pedidoId < 1) {
    return { ok: false, error: 'Pedido inválido' };
  }

  try {
    await ensureCuponesSchema();

    // Primero se consume el uso: si el cupón ya agotó su cupo no queda ningún efecto
    const consumo = await sql`
      UPDATE cupones
      SET uso_actual = COALESCE(uso_actual, 0) + 1, actualizado_en = NOW()
      WHERE id = ${cuponId}
        AND (uso_maximo IS NULL OR COALESCE(uso_actual, 0) < uso_maximo)
      RETURNING id
    `;

    if (!consumo || !consumo.length) {
      return { ok: false, error: 'El cupón alcanzó su límite de usos' };
    }

    try {
      await sql`
        INSERT INTO cupon_usos (
          cupon_id, pedido_venta_id, descuento_aplicado, cliente_id,
          base_comisionable, porcentaje_comision, comision_monto, usado_en
        )
        VALUES (
          ${cuponId},
          ${pedidoId},
          ${roundCurrency(descuentoAplicado)},
          ${clienteId == null ? null : Number(clienteId)},
          ${roundCurrency(comision.base_comisionable)},
          ${Number(comision.porcentaje_comision) || 0},
          ${roundCurrency(comision.comision_monto)},
          NOW()
        )
        ON CONFLICT (cupon_id, pedido_venta_id) DO UPDATE SET
          descuento_aplicado = EXCLUDED.descuento_aplicado,
          base_comisionable = EXCLUDED.base_comisionable,
          porcentaje_comision = EXCLUDED.porcentaje_comision,
          comision_monto = EXCLUDED.comision_monto
      `;
    } catch (insertError) {
      // Se compensa el consumo para no dejar el cupón con usos gastados sin canje
      await sql`
        UPDATE cupones
        SET uso_actual = GREATEST(COALESCE(uso_actual, 0) - 1, 0)
        WHERE id = ${cuponId}
      `;
      throw insertError;
    }

    return { ok: true };
  } catch (error) {
    console.error('Error registrando uso de cupón:', error.message || error);
    return { ok: false, error: 'No se pudo aplicar el cupón al pedido' };
  }
}

/**
 * Revierte el uso de cupón de un pedido cancelado: libera el cupo consumido
 * en `cupones.uso_actual` y elimina el registro de `cupon_usos`, siempre que
 * el pedido no haya llegado a pagarse (la comisión ya congelada no se toca).
 */
async function revertirUsoCupon(pedidoVentaId) {
  const pedidoId = Number(pedidoVentaId);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) return;
  try {
    const usos = await sql`
      SELECT cupon_id FROM cupon_usos
      WHERE pedido_venta_id = ${pedidoId} AND pedido_pagado_en IS NULL
    `;
    for (const uso of usos || []) {
      await sql`DELETE FROM cupon_usos WHERE cupon_id = ${uso.cupon_id} AND pedido_venta_id = ${pedidoId}`;
      await sql`
        UPDATE cupones
        SET uso_actual = GREATEST(COALESCE(uso_actual, 0) - 1, 0), actualizado_en = NOW()
        WHERE id = ${uso.cupon_id}
      `;
    }
  } catch (error) {
    console.error('Error revirtiendo uso de cupón:', error.message || error);
  }
}

module.exports = {
  normalizeCodigo,
  roundCurrency,
  validarCupon,
  calcularDescuento,
  registrarUsoCupon,
  revertirUsoCupon,
  ensureCuponesSchema,
};
