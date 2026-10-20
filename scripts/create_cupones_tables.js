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

    console.log('Tablas de colaboradores y cupones creadas/verificadas.');
    process.exit(0);
  } catch (error) {
    console.error('Error creando tablas de cupones:', error.message || error);
    process.exit(1);
  }
})();