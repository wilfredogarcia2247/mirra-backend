require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Parámetros de negocio por defecto
const MARGEN_FIJO = 3.0; // multiplicador por defecto

async function recalculate() {
  console.log('Recalculando precios para todas las fórmulas...');
  try {
    // Buscar todas las fórmulas existentes con su producto y tamano
    const formulas = await sql`
      SELECT f.id AS formula_id, f.producto_terminado_id AS producto_id, f.tamano_id
      FROM formulas f
    `;

    for (const row of formulas) {
      const { formula_id, producto_id, tamano_id } = row;
      if (tamano_id == null) {
        console.warn(`Saltando fórmula ${formula_id}: no tiene tamano_id`);
        continue;
      }

      // Obtener los componentes (ingredientes) de la fórmula
      const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formula_id}`;

      let costo_formula = 0;
      for (const c of componentes) {
        // Intentar mapear materia_prima_id -> ingrediente en tabla ingredientes
        const ing = await sql`SELECT * FROM ingredientes WHERE codigo = ${c.materia_prima_id} OR id = ${c.materia_prima_id} LIMIT 1`;
        let costo_unit = null;
        if (ing && ing[0]) {
          costo_unit = Number(ing[0].costo);
        } else {
          // Si no hay entrada en ingredientes, intentar buscar en productos (si tiene costo)
          const prod = await sql`SELECT costo FROM productos WHERE id = ${c.materia_prima_id} LIMIT 1`;
          if (prod && prod[0] && prod[0].costo) costo_unit = Number(prod[0].costo);
        }
        // Si no se encuentra costo, asumir 0 y seguir
        const cantidad = Number(c.cantidad) || 0;
        if (costo_unit != null) costo_formula += cantidad * Number(costo_unit);
      }

      // Obtener costo de envase desde tamanos
      const tam = await sql`SELECT costo AS costo_envase, cantidad AS tamano_ml, precio_venta AS tamanos_precio FROM tamanos WHERE id = ${tamano_id} LIMIT 1`;
      const costo_envase = tam && tam[0] && tam[0].costo_envase ? Number(tam[0].costo_envase) : 0;

      const costo_total_fabricacion = costo_formula + costo_envase;

      // Margen: se puede leer desde producto o usar MARGEN_FIJO
      const prodMeta = await sql`SELECT margen FROM productos WHERE id = ${producto_id} LIMIT 1`;
      const margen = prodMeta && prodMeta[0] && prodMeta[0].margen ? Number(prodMeta[0].margen) : MARGEN_FIJO;

      const precio_venta_base = costo_total_fabricacion * margen;

      // Factor de tamaño (si existe)
      const tamFactorRow = await sql`SELECT factor_multiplicador_venta AS factor FROM tamanos WHERE id = ${tamano_id} LIMIT 1`;
      const factor = tamFactorRow && tamFactorRow[0] && tamFactorRow[0].factor ? Number(tamFactorRow[0].factor) : 1.0;

      const precio_venta_final = precio_venta_base * factor;

      const sku = `${producto_id}-${tamano_id}`;

      // Upsert en precio_productos
      await sql`
        INSERT INTO precio_productos (producto_id, tamano_id, sku, costo_formula, costo_total_fabricacion, margen_aplicado, precio_venta_base, factor_tamano, precio_venta_final, actualizado_en)
        VALUES (${producto_id}, ${tamano_id}, ${sku}, ${costo_formula}, ${costo_total_fabricacion}, ${margen}, ${precio_venta_base}, ${factor}, ${precio_venta_final}, NOW())
        ON CONFLICT (producto_id, tamano_id) DO UPDATE
        SET costo_formula = EXCLUDED.costo_formula,
            costo_total_fabricacion = EXCLUDED.costo_total_fabricacion,
            margen_aplicado = EXCLUDED.margen_aplicado,
            precio_venta_base = EXCLUDED.precio_venta_base,
            factor_tamano = EXCLUDED.factor_tamano,
            precio_venta_final = EXCLUDED.precio_venta_final,
            actualizado_en = NOW();
      `;
      console.log(`Actualizado precio: producto=${producto_id} tamano=${tamano_id} precio=${precio_venta_final.toFixed(4)}`);
    }

    console.log('Recalculo completado.');
  } catch (err) {
    console.error('Error en recalculo:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

recalculate();
