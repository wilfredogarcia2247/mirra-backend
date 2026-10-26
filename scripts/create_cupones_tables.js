require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está configurada');
}

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS colaboradores (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        instagram TEXT,
        tiktok TEXT,
        youtube TEXT,
        tipo TEXT NOT NULL CHECK (tipo IN ('trabajador', 'influencer', 'colaborador')),
        usuario_id INTEGER,
        observaciones TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_colaboradores_email ON colaboradores(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_colaboradores_tipo ON colaboradores(tipo)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_colaboradores_usuario ON colaboradores(usuario_id)`;
    await sql`ALTER TABLE colaboradores ALTER COLUMN activo TYPE INTEGER USING CASE WHEN activo::text IN ('true', '1') THEN 1 ELSE 0 END`;
    await sql`ALTER TABLE colaboradores ALTER COLUMN activo SET DEFAULT 1`;
    await sql`ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS porcentaje_comision NUMERIC(5, 2)`;
    await sql`UPDATE colaboradores SET porcentaje_comision = CASE WHEN tipo = 'influencer' THEN 10 ELSE 0 END WHERE porcentaje_comision IS NULL`;
    await sql`ALTER TABLE colaboradores ALTER COLUMN porcentaje_comision SET DEFAULT 0`;
    await sql`ALTER TABLE colaboradores ALTER COLUMN porcentaje_comision SET NOT NULL`;
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'colaboradores_porcentaje_comision_check'
        ) THEN
          ALTER TABLE colaboradores ADD CONSTRAINT colaboradores_porcentaje_comision_check
          CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100);
        END IF;
      END $$
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS cupones (
        id SERIAL PRIMARY KEY,
        codigo TEXT NOT NULL UNIQUE,
        descuento_porcentaje NUMERIC(5, 2) NOT NULL CHECK (descuento_porcentaje > 0 AND descuento_porcentaje <= 100),
        colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
        descripcion TEXT,
        fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fecha_fin TIMESTAMPTZ,
        uso_maximo INTEGER CHECK (uso_maximo IS NULL OR uso_maximo > 0),
        uso_actual INTEGER NOT NULL DEFAULT 0 CHECK (uso_actual >= 0),
        activo INTEGER NOT NULL DEFAULT 1,
        es_global INTEGER NOT NULL DEFAULT 0,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cupones_codigo ON cupones(codigo)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cupones_colaborador ON cupones(colaborador_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cupones_activo ON cupones(activo)`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS descripcion TEXT`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMPTZ`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS uso_maximo INTEGER`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS uso_actual INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE cupones ADD COLUMN IF NOT EXISTS es_global INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE cupones ALTER COLUMN activo TYPE INTEGER USING CASE WHEN activo::text IN ('true', '1') THEN 1 ELSE 0 END`;
    await sql`ALTER TABLE cupones ALTER COLUMN activo SET DEFAULT 1`;
    await sql`ALTER TABLE cupones ALTER COLUMN es_global TYPE INTEGER USING CASE WHEN es_global::text IN ('true', '1') THEN 1 ELSE 0 END`;
    await sql`ALTER TABLE cupones ALTER COLUMN es_global SET DEFAULT 0`;

    await sql`
      CREATE TABLE IF NOT EXISTS cupon_usos (
        id SERIAL PRIMARY KEY,
        cupon_id INTEGER NOT NULL REFERENCES cupones(id) ON DELETE CASCADE,
        pedido_venta_id INTEGER NOT NULL REFERENCES pedidos_venta(id) ON DELETE CASCADE,
        descuento_aplicado NUMERIC(12, 2) NOT NULL CHECK (descuento_aplicado >= 0),
        usado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (cupon_id, pedido_venta_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cupon_usos_cupon ON cupon_usos(cupon_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cupon_usos_pedido ON cupon_usos(pedido_venta_id)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS cliente_id INTEGER`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS descuento_aplicado NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS base_comisionable NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS porcentaje_comision NUMERIC(5, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS comision_monto NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS total_pedido_snapshot NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS recargo_snapshot NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS iva_snapshot NUMERIC(12, 2)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS tasa_cambio_snapshot NUMERIC(14, 6)`;
    await sql`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS pedido_pagado_en TIMESTAMPTZ`;
    await sql`
      CREATE TABLE IF NOT EXISTS influencer_comision_pagos (
        id SERIAL PRIMARY KEY,
        colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
        monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
        fecha_corte DATE,
        fecha_pago TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        referencia TEXT NOT NULL,
        comprobante_url TEXT,
        observaciones TEXT,
        usuario_admin_id INTEGER,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE influencer_comision_pagos ADD COLUMN IF NOT EXISTS fecha_corte DATE`;
    await sql`ALTER TABLE influencer_comision_pagos ADD COLUMN IF NOT EXISTS comprobante_url TEXT`;
    // El comprobante se guarda como key del archivo (S3/MinIO), no como URL firmada:
    // una URL firmada vence, la key no. La URL se reconstruye al leerla.
    await sql`ALTER TABLE influencer_comision_pagos ADD COLUMN IF NOT EXISTS comprobante_key TEXT`;
    await sql`UPDATE influencer_comision_pagos SET fecha_corte = COALESCE(fecha_pago, NOW())::date WHERE fecha_corte IS NULL`;
    await sql`ALTER TABLE influencer_comision_pagos ALTER COLUMN fecha_corte SET NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_influencer_comision_pagos_colaborador ON influencer_comision_pagos(colaborador_id, fecha_pago DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_influencer_comision_pagos_fecha_corte ON influencer_comision_pagos(colaborador_id, fecha_corte)`;
    // `usado_en` nació como timestamp sin zona horaria: los valores guardados son UTC.
    // Se pasa a TIMESTAMPTZ para que el instante sea correcto en el panel de administración.
    // La conversión solo aplica si la columna aún no tiene zona horaria (evita desplazar
    // los instantes ya corregidos si se vuelve a ejecutar el script).
    const usadoEnColumn = await sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'cupon_usos' AND column_name = 'usado_en'
    `;
    if (usadoEnColumn && usadoEnColumn[0] && usadoEnColumn[0].data_type === 'timestamp without time zone') {
      await sql`
        ALTER TABLE cupon_usos
        ALTER COLUMN usado_en TYPE TIMESTAMPTZ
        USING usado_en AT TIME ZONE 'UTC'
      `;
      await sql`ALTER TABLE cupon_usos ALTER COLUMN usado_en SET DEFAULT NOW()`;
      await sql`ALTER TABLE cupon_usos ALTER COLUMN usado_en SET NOT NULL`;
    }
    // Instalaciones previas usaban la columna `descuentoaplicado` (sin guion bajo)
    const legacyColumn = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cupon_usos' AND column_name = 'descuentoaplicado'
    `;
    if (legacyColumn && legacyColumn.length) {
      await sql`
        UPDATE cupon_usos
        SET descuento_aplicado = descuentoaplicado
        WHERE descuento_aplicado IS NULL AND descuentoaplicado IS NOT NULL
      `;
      // La columna legacy (NOT NULL sin default) estorba el canje: se elimina tras el backfill
      await sql`ALTER TABLE cupon_usos DROP COLUMN IF EXISTS descuentoaplicado`;
    }
    await sql`UPDATE cupon_usos SET descuento_aplicado = 0 WHERE descuento_aplicado IS NULL`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN descuento_aplicado SET NOT NULL`;
    await sql`
      CREATE TABLE IF NOT EXISTS pedido_venta_ajustes (
        id SERIAL PRIMARY KEY,
        pedido_venta_id INT NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        modo VARCHAR(20) NOT NULL,
        valor NUMERIC NOT NULL,
        motivo TEXT NOT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_pedido_venta_ajustes_pedido ON pedido_venta_ajustes (pedido_venta_id)`;
    await sql`
      UPDATE cupon_usos cu
      SET base_comisionable = GREATEST(0, ROUND((
            COALESCE(lineas.total, 0) - COALESCE(ajustes.total_descuentos, 0)
            - COALESCE(pv.descuento_cupon, cu.descuento_aplicado, 0)
          ) / 1.16, 2)),
          porcentaje_comision = CASE WHEN col.tipo = 'influencer' THEN COALESCE(col.porcentaje_comision, 10) ELSE 0 END,
          comision_monto = CASE
            WHEN col.tipo = 'influencer'
              AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado') THEN ROUND(
              GREATEST(0, (
                COALESCE(lineas.total, 0) - COALESCE(ajustes.total_descuentos, 0)
                - COALESCE(pv.descuento_cupon, cu.descuento_aplicado, 0)
              ) / 1.16) * COALESCE(col.porcentaje_comision, 10) / 100,
              2
            )
            ELSE 0
          END
      FROM pedidos_venta pv
      CROSS JOIN cupones c
      LEFT JOIN colaboradores col ON col.id = c.colaborador_id
      LEFT JOIN LATERAL (
        SELECT SUM(pvp.cantidad * COALESCE(pvp.precio_venta, prod.precio_venta, 0)) AS total
        FROM pedido_venta_productos pvp
        LEFT JOIN productos prod ON prod.id = pvp.producto_id
        WHERE pvp.pedido_venta_id = pv.id
      ) lineas ON TRUE
      LEFT JOIN LATERAL (
        SELECT ROUND(SUM(CASE WHEN LOWER(a.tipo) = 'descuento' THEN
          CASE WHEN LOWER(a.modo) = 'porcentaje' THEN COALESCE(lineas.total, 0) * a.valor / 100 ELSE a.valor END
          ELSE 0 END), 2) AS total_descuentos
        FROM pedido_venta_ajustes a
        WHERE a.pedido_venta_id = pv.id
      ) ajustes ON TRUE
      WHERE c.id = cu.cupon_id
        AND cu.pedido_venta_id = pv.id
        AND (cu.base_comisionable IS NULL OR cu.porcentaje_comision IS NULL OR cu.comision_monto IS NULL)
    `;
    await sql`UPDATE cupon_usos SET base_comisionable = 0 WHERE base_comisionable IS NULL`;
    await sql`UPDATE cupon_usos SET porcentaje_comision = 0 WHERE porcentaje_comision IS NULL`;
    await sql`UPDATE cupon_usos SET comision_monto = 0 WHERE comision_monto IS NULL`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN base_comisionable SET DEFAULT 0`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN base_comisionable SET NOT NULL`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN porcentaje_comision SET DEFAULT 0`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN porcentaje_comision SET NOT NULL`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN comision_monto SET DEFAULT 0`;
    await sql`ALTER TABLE cupon_usos ALTER COLUMN comision_monto SET NOT NULL`;
    await sql`
      CREATE TABLE IF NOT EXISTS pagos (
        id SERIAL PRIMARY KEY,
        pedido_venta_id INT,
        forma_pago_id INT,
        banco_id INT,
        monto NUMERIC,
        referencia TEXT,
        fecha_transaccion TIMESTAMP,
        fecha TIMESTAMP,
        tasa NUMERIC,
        tasa_simbolo VARCHAR(10)
      )
    `;
    // Índice único para que un pedido no pueda canjear dos veces el mismo cupón
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
    await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS cupon_id INTEGER`;
    await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS cupon_codigo TEXT`;
    await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_cupon NUMERIC(12, 2) NOT NULL DEFAULT 0`;
    await sql`
      WITH lineas AS (
        SELECT pvp.pedido_venta_id,
          SUM(pvp.cantidad * COALESCE(pvp.precio_venta, prod.precio_venta, 0)) AS subtotal
        FROM pedido_venta_productos pvp
        LEFT JOIN productos prod ON prod.id = pvp.producto_id
        GROUP BY pvp.pedido_venta_id
      ), ajustes AS (
        SELECT a.pedido_venta_id,
          COALESCE(SUM(CASE WHEN LOWER(a.tipo) = 'descuento' THEN
            CASE WHEN LOWER(a.modo) = 'porcentaje' THEN COALESCE(l.subtotal, 0) * a.valor / 100 ELSE a.valor END
            ELSE 0 END), 0) AS descuentos,
          COALESCE(SUM(CASE WHEN LOWER(a.tipo) = 'recargo' THEN
            CASE WHEN LOWER(a.modo) = 'porcentaje' THEN COALESCE(l.subtotal, 0) * a.valor / 100 ELSE a.valor END
            ELSE 0 END), 0) AS recargos
        FROM pedido_venta_ajustes a
        LEFT JOIN lineas l ON l.pedido_venta_id = a.pedido_venta_id
        GROUP BY a.pedido_venta_id
      ), pagos_equivalentes AS (
        SELECT p.pedido_venta_id,
          SUM(CASE WHEN p.tasa > 0 THEN p.monto / p.tasa ELSE p.monto END) AS total_pagado_usd,
          MAX(COALESCE(p.fecha_transaccion, p.fecha)) AS ultimo_pago_en
        FROM pagos p
        GROUP BY p.pedido_venta_id
      ), pedidos AS (
        SELECT cu.id AS uso_id, pv.id AS pedido_id, pv.estado, pv.fecha,
          COALESCE(pv.tasa_cambio_monto, (
            SELECT tc.monto FROM tasas_cambio tc
            WHERE tc.creado_en <= pv.fecha
            ORDER BY tc.creado_en DESC, tc.id DESC LIMIT 1
          ), (
            SELECT tc.monto FROM tasas_cambio tc
            WHERE tc.activo = TRUE ORDER BY tc.id DESC LIMIT 1
          )) AS tasa,
          COALESCE(l.subtotal, 0) AS subtotal,
          COALESCE(a.descuentos, 0) AS descuentos,
          COALESCE(a.recargos, 0) AS recargos,
          COALESCE(pv.descuento_cupon, cu.descuento_aplicado, 0) AS descuento_cupon,
          COALESCE(pe.total_pagado_usd, 0) AS total_pagado_usd,
          pe.ultimo_pago_en,
          cu.porcentaje_comision, col.tipo
        FROM cupon_usos cu
        JOIN cupones c ON c.id = cu.cupon_id
        JOIN colaboradores col ON col.id = c.colaborador_id
        JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
        LEFT JOIN lineas l ON l.pedido_venta_id = pv.id
        LEFT JOIN ajustes a ON a.pedido_venta_id = pv.id
        LEFT JOIN pagos_equivalentes pe ON pe.pedido_venta_id = pv.id
        WHERE col.tipo = 'influencer'
      ), calculados AS (
        SELECT *,
          GREATEST(0, ROUND(subtotal - descuentos - descuento_cupon + recargos, 2)) AS total_final,
          GREATEST(0, ROUND((subtotal - descuentos - descuento_cupon) / 1.16, 2)) AS base
        FROM pedidos
      )
      UPDATE cupon_usos cu
      SET total_pedido_snapshot = calc.total_final,
          recargo_snapshot = calc.recargos,
          iva_snapshot = ROUND(calc.total_final - calc.recargos - calc.base, 2),
          base_comisionable = calc.base,
          tasa_cambio_snapshot = calc.tasa,
          comision_monto = ROUND(calc.base * calc.porcentaje_comision / 100, 2),
          pedido_pagado_en = COALESCE(calc.ultimo_pago_en, pv.fecha, NOW())
      FROM calculados calc
      JOIN pedidos_venta pv ON pv.id = calc.pedido_id
      WHERE cu.id = calc.uso_id
        AND cu.pedido_pagado_en IS NULL
        AND LOWER(COALESCE(calc.estado, '')) IN ('completado', 'pagado')
        AND LOWER(COALESCE(calc.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
        AND calc.total_pagado_usd >= calc.total_final - 0.05
    `;

    console.log('Tablas de colaboradores y cupones creadas/verificadas.');
    process.exit(0);
  } catch (error) {
    console.error('Error creando tablas de cupones:', error.message || error);
    process.exit(1);
  }
})();