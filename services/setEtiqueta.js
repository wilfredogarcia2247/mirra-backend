// Etiqueta del "Set toda ocasión" en cada perfume del pedido ('mujer' = set para ella,
// 'hombre' = set para él, NULL = perfume suelto). Solo sirve para mostrar el pedido agrupado
// (WhatsApp, Copiar pedido, detalle del panel): producción, inventario y reportes siguen
// trabajando perfume por perfume y no la usan.
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

let asegurada = null;

// Crea la columna si falta (mismo patrón que el resto del proyecto: sin migraciones)
function asegurarColumnaSet() {
  if (!asegurada) {
    asegurada = sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS set_etiqueta TEXT`
      .catch((e) => {
        asegurada = null; // reintentar en la próxima consulta
        throw e;
      });
  }
  return asegurada;
}

// Solo se aceptan los dos valores conocidos; cualquier otra cosa se guarda como suelto
function limpiarSetEtiqueta(valor) {
  return valor === 'mujer' || valor === 'hombre' ? valor : null;
}

module.exports = { asegurarColumnaSet, limpiarSetEtiqueta };
