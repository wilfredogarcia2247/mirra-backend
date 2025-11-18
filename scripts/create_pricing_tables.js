const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('Creando tablas relacionadas con IA de precios (ingredientes, precio_productos) ...');
  try {
    // Ingredientes: maestro de materias primas con costo por unidad (ml o g)
    await sql`
      CREATE TABLE IF NOT EXISTS ingredientes (
        id BIGSERIAL PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE,
        nombre VARCHAR(255) NOT NULL,
        unidad VARCHAR(20) DEFAULT 'ml',
        costo NUMERIC(12,4) DEFAULT 0, -- costo por unidad (ml o g)
        creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Tabla resultado: precios y costos calculados por producto/tamano
    await sql`
      CREATE TABLE IF NOT EXISTS precio_productos (
        id BIGSERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL,
        tamano_id INTEGER NOT NULL,
        sku VARCHAR(120) UNIQUE,
        costo_formula NUMERIC(14,4) DEFAULT 0,
        costo_total_fabricacion NUMERIC(14,4) DEFAULT 0,
        margen_aplicado NUMERIC(6,4) DEFAULT 1.0,
        precio_venta_base NUMERIC(14,4) DEFAULT 0,
        factor_tamano NUMERIC(6,4) DEFAULT 1.0,
        precio_venta_final NUMERIC(14,4) DEFAULT 0,
        actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Índices compuestos útiles
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_precio_prod_tamano ON precio_productos (producto_id, tamano_id);`;

    console.log('Tablas creadas o ya existentes.');
  } catch (err) {
    console.error('Error creando tablas:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

run();
