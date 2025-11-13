require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function initDB() {
    // Verificar y crear tabla usuarios si no existe
    await sql`CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      rol VARCHAR(20)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      rol VARCHAR(20)
    );`;
    await sql`INSERT INTO usuarios (nombre, email, password, rol) VALUES
      ('Administrador', 'admin@aromas.com', '$2a$10$adminhash', 'admin'),
      ('Empleado', 'empleado@aromas.com', '$2a$10$empleadohash', 'empleado')
      ON CONFLICT (email) DO NOTHING;`;
  // ALTER TABLE para agregar columnas si no existen
  try { await sql`ALTER TABLE contactos ADD COLUMN banco VARCHAR(100);`; } catch(e) {}
  try { await sql`ALTER TABLE contactos ADD COLUMN cuenta_bancaria VARCHAR(50);`; } catch(e) {}
  try { await sql`ALTER TABLE contactos ADD COLUMN formas_pago VARCHAR(100);`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS bancos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100)
    );`;
  // Asegurar columna para moneda en bancos
  try { await sql`ALTER TABLE bancos ADD COLUMN moneda VARCHAR(10);`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS cliente_bancos (
      id SERIAL PRIMARY KEY,
      cliente_id INT,
      banco_id INT,
      cuenta_bancaria VARCHAR(50)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS pagos (
      id SERIAL PRIMARY KEY,
      pedido_venta_id INT,
      forma_pago_id INT,
      banco_id INT,
      monto NUMERIC,
      fecha TIMESTAMP
    );`;
    // Asegurar columnas adicionales para registros de pago
    try { await sql`ALTER TABLE pagos ADD COLUMN referencia TEXT;`; } catch(e) {}
    try { await sql`ALTER TABLE pagos ADD COLUMN fecha_transaccion TIMESTAMP;`; } catch(e) {}
    // Asegurar columnas para tasa y símbolo en pagos
    try { await sql`ALTER TABLE pagos ADD COLUMN tasa NUMERIC;`; } catch(e) {}
    try { await sql`ALTER TABLE pagos ADD COLUMN tasa_simbolo VARCHAR(10);`; } catch(e) {}
    await sql`INSERT INTO bancos (nombre) VALUES
      ('Banco Uno'),
      ('Banco Dos')
      ON CONFLICT DO NOTHING;`;
    await sql`INSERT INTO cliente_bancos (cliente_id, banco_id, cuenta_bancaria) VALUES
      (1, 1, '1234567890'),
      (2, 2, '0987654321')
      ON CONFLICT DO NOTHING;`;
  try {
    // Crear tablas (una por una)
    await sql`CREATE TABLE IF NOT EXISTS proveedores (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      telefono VARCHAR(30),
      email VARCHAR(100)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      tipo VARCHAR(30),
      unidad VARCHAR(20),
      stock INT,
      costo NUMERIC,
      precio_venta NUMERIC,
      proveedor_id INT
    );`;
    // Asegurar la columna image_url en productos (migración segura)
    try { await sql`ALTER TABLE productos ADD COLUMN image_url TEXT;`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS almacenes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      tipo VARCHAR(30),
      ubicacion VARCHAR(200),
      responsable VARCHAR(100)
    );`;
    // Asegurar columnas en caso de migracion previa
    try { await sql`ALTER TABLE almacenes ADD COLUMN ubicacion VARCHAR(200);`; } catch(e) {}
    try { await sql`ALTER TABLE almacenes ADD COLUMN responsable VARCHAR(100);`; } catch(e) {}
    // Asegurar columna es_materia_prima para indicar si el almacén es de materia prima (boolean)
    try { await sql`ALTER TABLE almacenes ADD COLUMN es_materia_prima BOOLEAN DEFAULT FALSE;`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS formulas (
      id SERIAL PRIMARY KEY,
      producto_terminado_id INT
    );`;
    // Asegurar columna nombre en formulas (migración segura)
    try { await sql`ALTER TABLE formulas ADD COLUMN nombre VARCHAR(200);`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS formula_componentes (
      id SERIAL PRIMARY KEY,
      formula_id INT,
      materia_prima_id INT,
      cantidad NUMERIC,
      unidad VARCHAR(20)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS ordenes_produccion (
      id SERIAL PRIMARY KEY,
      producto_terminado_id INT,
      cantidad INT,
      formula_id INT,
      estado VARCHAR(30),
      fecha TIMESTAMP
    );`;
    await sql`CREATE TABLE IF NOT EXISTS inventario (
      id SERIAL PRIMARY KEY,
      producto_id INT,
      almacen_id INT,
      stock_fisico INT,
      stock_comprometido INT
    );`;
    // Tabla para tasas de cambio
    await sql`CREATE TABLE IF NOT EXISTS tasas_cambio (
      id SERIAL PRIMARY KEY,
      monto NUMERIC NOT NULL,
      simbolo VARCHAR(10) NOT NULL,
      descripcion TEXT,
      creado_en TIMESTAMP DEFAULT NOW(),
      actualizado_en TIMESTAMP
    );`;
    // Asegurar columna activo y un índice parcial único para que sólo una tasa pueda estar activa
    try { await sql`ALTER TABLE tasas_cambio ADD COLUMN activo BOOLEAN DEFAULT FALSE;`; } catch(e) {}
    try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasas_cambio_activo_true ON tasas_cambio (activo) WHERE activo = TRUE;`; } catch(e) {}
    // Tabla de movimientos de inventario para auditoría
    await sql`CREATE TABLE IF NOT EXISTS inventario_movimientos (
      id SERIAL PRIMARY KEY,
      producto_id INT,
      almacen_id INT,
      tipo VARCHAR(20), -- 'entrada'|'salida'
      cantidad NUMERIC,
      motivo TEXT,
      referencia TEXT,
      creado_en TIMESTAMP DEFAULT NOW()
    );`;
    await sql`CREATE TABLE IF NOT EXISTS contactos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      tipo VARCHAR(30),
      telefono VARCHAR(30),
      email VARCHAR(100),
      banco VARCHAR(100),
      cuenta_bancaria VARCHAR(50),
      formas_pago VARCHAR(100)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS formas_pago (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(50)
    );`;
    await sql`CREATE TABLE IF NOT EXISTS pedidos_venta (
      id SERIAL PRIMARY KEY,
      cliente_id INT,
      estado VARCHAR(30),
      fecha TIMESTAMP
    );`;
    // Asegurar columnas adicionales para pedidos_venta (migración segura)
    try { await sql`ALTER TABLE pedidos_venta ADD COLUMN nombre_cliente TEXT;`; } catch(e) {}
    try { await sql`ALTER TABLE pedidos_venta ADD COLUMN telefono TEXT;`; } catch(e) {}
    try { await sql`ALTER TABLE pedidos_venta ADD COLUMN cedula TEXT;`; } catch(e) {}
    try { await sql`ALTER TABLE pedidos_venta ADD COLUMN origen_ip TEXT;`; } catch(e) {}
    try { await sql`ALTER TABLE pedidos_venta ADD COLUMN user_agent TEXT;`; } catch(e) {}
  // Agregar columna para snapshot del valor de la tasa de cambio en pedidos_venta
  // Solo almacenamos el monto (decimal) de la tasa en el momento del pedido
  try { await sql`ALTER TABLE pedidos_venta ADD COLUMN tasa_cambio_monto NUMERIC;`; } catch(e) {}
  // Remover columnas previas si existen (tasa_cambio_id, tasa_cambio_simbolo) — ahora no las usamos
  try { await sql`ALTER TABLE pedidos_venta DROP COLUMN IF EXISTS tasa_cambio_id;`; } catch(e) {}
  try { await sql`ALTER TABLE pedidos_venta DROP COLUMN IF EXISTS tasa_cambio_simbolo;`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS pedido_venta_productos (
      id SERIAL PRIMARY KEY,
      pedido_venta_id INT,
      producto_id INT,
      cantidad INT
    );`;
    // Asegurar columnas para snapshot de precio y costo en líneas de pedido (migración segura)
  // Remove legacy column precio_unitario if present
  try { await sql`ALTER TABLE pedido_venta_productos DROP COLUMN IF EXISTS precio_unitario;`; } catch(e) {}
    try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN costo_unitario NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN nombre_producto TEXT;`; } catch(e) {}
    await sql`CREATE TABLE IF NOT EXISTS pedidos_compra (
      id SERIAL PRIMARY KEY,
      proveedor_id INT,
      estado VARCHAR(30),
      fecha TIMESTAMP
    );`;
    await sql`CREATE TABLE IF NOT EXISTS pedido_compra_productos (
      id SERIAL PRIMARY KEY,
      pedido_compra_id INT,
      producto_id INT,
      cantidad INT
    );`;

    // Semillas y datos falsos (una por una)
    await sql`INSERT INTO proveedores (nombre, telefono, email) VALUES
      ('Proveedor Aromas', '123456789', 'aromas@proveedor.com'),
      ('Proveedor Frascos', '987654321', 'frascos@proveedor.com')
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO productos (nombre, tipo, unidad, stock, costo, proveedor_id) VALUES
      ('Esencia de Jazmín', 'MateriaPrima', 'ml', 1000, 0.5, 1),
      ('Alcohol de Perfumería', 'MateriaPrima', 'ml', 5000, 0.2, 1),
      ('Fijador', 'MateriaPrima', 'ml', 2000, 0.3, 1),
      ('Frasco de Vidrio 50ml', 'MateriaPrima', 'unidad', 200, 1.0, 2),
      ('Tapa Atomizadora', 'MateriaPrima', 'unidad', 200, 0.5, 2),
      ('Etiqueta "Floral N°5"', 'MateriaPrima', 'unidad', 200, 0.1, 2)
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO productos (nombre, tipo, unidad, stock, precio_venta) VALUES
      ('Perfume Floral N°5 - 50ml', 'ProductoTerminado', 'unidad', 0, 25.0)
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO almacenes (nombre, tipo) VALUES
      ('Almacén de Materia Prima', 'Interno'),
      ('Almacén de Venta', 'Venta')
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO formulas (producto_terminado_id) VALUES (7)
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO formula_componentes (formula_id, materia_prima_id, cantidad, unidad) VALUES
      (1, 1, 10, 'ml'),
      (1, 2, 35, 'ml'),
      (1, 3, 5, 'ml'),
      (1, 4, 1, 'unidad'),
      (1, 5, 1, 'unidad'),
      (1, 6, 1, 'unidad')
      ON CONFLICT DO NOTHING;`;

    await sql`INSERT INTO contactos (nombre, tipo, telefono, email, banco, cuenta_bancaria, formas_pago) VALUES
      ('Cliente Uno', 'Cliente', '555111222', 'cliente1@aromas.com', 'Banco Uno', '1234567890', 'Tarjeta,Transferencia'),
      ('Cliente Dos', 'Cliente', '555333444', 'cliente2@aromas.com', 'Banco Dos', '0987654321', 'Efectivo,Transferencia')
      ON CONFLICT DO NOTHING;`;
    await sql`INSERT INTO formas_pago (nombre) VALUES
      ('Tarjeta'),
      ('Transferencia'),
      ('Efectivo')
      ON CONFLICT DO NOTHING;`;

    // Asegurar existencia de la forma 'Pago Movil' y crear tabla de relación banco -> formas_pago
    try {
      await sql`INSERT INTO formas_pago (nombre) SELECT 'Pago Movil' WHERE NOT EXISTS (SELECT 1 FROM formas_pago WHERE nombre = 'Pago Movil')`;
    } catch(e) {}

    // Tabla que asocia bancos con formas de pago y guarda detalles (json) por banco
    await sql`CREATE TABLE IF NOT EXISTS banco_formas_pago (
      id SERIAL PRIMARY KEY,
      banco_id INT REFERENCES bancos(id) ON DELETE CASCADE,
      forma_pago_id INT REFERENCES formas_pago(id) ON DELETE RESTRICT,
      detalles JSONB,
      creado_en TIMESTAMP DEFAULT NOW()
    );`;

    // Semillas: asociar ejemplos de formas de pago a los bancos existentes
    try {
      // Insertar asociación sólo si no existe
      await sql`
        INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles)
        SELECT b.id, f.id, jsonb_build_object('tipo','cuenta','valor','1234567890','observaciones','Cuenta principal')
        FROM bancos b, formas_pago f
        WHERE b.nombre = 'Banco Uno' AND f.nombre = 'Transferencia'
        AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);
      `;
      await sql`
        INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles)
        SELECT b.id, f.id, jsonb_build_object('tipo','pago_movil','operador','MOV','numero','04141234567','observaciones','Pago móvil del comercio')
        FROM bancos b, formas_pago f
        WHERE b.nombre = 'Banco Uno' AND f.nombre = 'Pago Movil'
        AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);
      `;
      await sql`
        INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles)
        SELECT b.id, f.id, jsonb_build_object('tipo','cuenta','valor','0987654321','observaciones','Cuenta de pagos')
        FROM bancos b, formas_pago f
        WHERE b.nombre = 'Banco Dos' AND f.nombre = 'Transferencia'
        AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);
      `;
      // Semilla: Banco de Venezuela con Transferencia y Pago Movil
      await sql`
        INSERT INTO bancos (nombre)
        SELECT 'Banco de Venezuela' WHERE NOT EXISTS (SELECT 1 FROM bancos WHERE nombre = 'Banco de Venezuela');
      `;
      await sql`
        INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles)
        SELECT b.id, f.id, jsonb_build_object('tipo','cuenta','valor','00012345678','observaciones','Cuenta principal Banco de Venezuela')
        FROM bancos b, formas_pago f
        WHERE b.nombre = 'Banco de Venezuela' AND f.nombre = 'Transferencia'
        AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);
      `;
      await sql`
        INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles)
        SELECT b.id, f.id, jsonb_build_object('tipo','pago_movil','operador','MOV','numero','04241234567','observaciones','Pago móvil Banco de Venezuela')
        FROM bancos b, formas_pago f
        WHERE b.nombre = 'Banco de Venezuela' AND f.nombre = 'Pago Movil'
        AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);
      `;
    } catch (e) {}

    await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES
      (1, 1, 1000, 0),
      (2, 1, 5000, 0),
      (3, 1, 2000, 0),
      (4, 1, 200, 0),
      (5, 1, 200, 0),
      (6, 1, 200, 0),
      (7, 2, 0, 0)
      ON CONFLICT DO NOTHING;`;

    console.log('Tablas y datos de prueba creados en NeonDB');
  } catch (error) {
    console.error('Error inicializando NeonDB:', error);
  }
}

initDB();
