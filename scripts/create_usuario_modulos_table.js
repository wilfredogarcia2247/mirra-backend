require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    console.log('Creando tabla usuario_modulos (si no existe)...');
    await sql`
      CREATE TABLE IF NOT EXISTS usuario_modulos (
        id SERIAL PRIMARY KEY,
        usuario_id INT UNIQUE,
        dashboard BOOLEAN DEFAULT FALSE,
        tasas_cambio BOOLEAN DEFAULT FALSE,
        bancos BOOLEAN DEFAULT FALSE,
        marcas BOOLEAN DEFAULT FALSE,
        categorias BOOLEAN DEFAULT FALSE,
        almacenes BOOLEAN DEFAULT FALSE,
        productos BOOLEAN DEFAULT FALSE,
        formulas BOOLEAN DEFAULT FALSE,
        pedidos BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Intentar agregar FK a usuarios si la tabla existe (operación defensiva)
    try {
      await sql`
        ALTER TABLE usuario_modulos
        ADD CONSTRAINT usuario_modulos_usuario_fk FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id) ON DELETE CASCADE;
      `;
    } catch (e) {
      // Ignorar errores (por ejemplo, si la constraint ya existe o la tabla usuarios no existe aún)
    }

    console.log('Tabla usuario_modulos creada / verificada.');
    process.exit(0);
  } catch (err) {
    console.error('Error creando tabla usuario_modulos:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
