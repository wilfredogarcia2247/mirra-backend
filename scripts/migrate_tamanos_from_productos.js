require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Extrae tamaños desde productos.nombre usando patrón como "50ml" o "100 ml".
// Inserta en tamanos(producto_id, nombre, cantidad, unidad, costo, precio_venta) si no existe.

function normalizeUnit(u) {
  if (!u) return null;
  u = ('' + u).toLowerCase();
  if (u === 'l' || u === 'lt' || u === 'lts') return 'l';
  if (u === 'gr' || u === 'g') return 'g';
  if (u === 'kg') return 'kg';
  if (u.startsWith('ml')) return 'ml';
  if (u.startsWith('unidad') || u.startsWith('unid') || u.startsWith('uds') || u.startsWith('unidades')) return 'unidad';
  return u;
}

(async () => {
  try {
    const prods = await sql`SELECT id, nombre, unidad, costo, precio_venta FROM productos`;
    let created = 0;
    let skipped = 0;
    for (const p of prods) {
      const nombre = p.nombre || '';
      // Buscar patrón de tamaño: número (decimales con . o ,) seguido por unidad (ml|g|kg|l|lt|unidad|unidades)
      const re = /([0-9]+(?:[.,][0-9]+)?)\s*(ml|g|kg|l|lt|gr|grs|unidad|unidades|uds)\b/i;
      const m = nombre.match(re);
      let qty = null;
      let unit = null;
      if (m) {
        qty = parseFloat(m[1].replace(',', '.'));
        unit = normalizeUnit(m[2]);
      } else if (p.unidad) {
        // Si no encontramos en el nombre, pero la columna unidad es explícita (y producto nombre contiene un número), intentamos extraer número del nombre
        const re2 = /([0-9]+(?:[.,][0-9]+)?)/;
        const m2 = nombre.match(re2);
        const nu = normalizeUnit(p.unidad);
        if (m2 && nu) {
          qty = parseFloat(m2[1].replace(',', '.'));
          unit = nu;
        }
      }

      if (!unit) {
        skipped++;
        continue; // no podemos inferir tamaño
      }

      const tamaname = `${qty != null ? qty : ''}${unit}`;

      // Comprobar existencia
      const exists = await sql`SELECT * FROM tamanos WHERE producto_id = ${p.id} AND nombre = ${tamaname}`;
      if (exists && exists.length > 0) {
        continue; // ya existe
      }

      // Insertar
      await sql`
        INSERT INTO tamanos (producto_id, nombre, cantidad, unidad, costo, precio_venta)
        VALUES (${p.id}, ${tamaname}, ${qty}, ${unit}, ${p.costo}, ${p.precio_venta})
      `;
      created += 1;
    }
    console.log(`Tamanos creados: ${created}, saltados: ${skipped}`);
    process.exit(0);
  } catch (e) {
    console.error('Error migrando tamaños:', e);
    process.exit(2);
  }
})();
