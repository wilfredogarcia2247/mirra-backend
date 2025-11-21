require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function inspect() {
  try {
    const pedidoId = 3;
    console.log('Consultando líneas de pedido para pedido_venta_id =', pedidoId);
    const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId} ORDER BY id`;
    if (!lineas || lineas.length === 0) {
      console.log('No se encontraron líneas para ese pedido');
      return;
    }
    for (const l of lineas) {
      console.log('\n--- Línea ---');
      console.log('id:', l.id);
      console.log('producto_id:', l.producto_id);
      console.log('producto_nombre:', l.producto_nombre);
      console.log('formula_id:', l.formula_id);
      console.log('nombre_formula:', l.nombre_formula);
      if (l.formula_id) {
        console.log(' -> Consultando componentes de formula_id =', l.formula_id);
        // intentaremos obtener componentes desde formula_componentes joined with productos
        const comps = await sql`
          SELECT fc.*, p.nombre as producto_nombre
          FROM formula_componentes fc
          LEFT JOIN productos p ON p.id = fc.materia_prima_id
          WHERE fc.formula_id = ${l.formula_id}
          ORDER BY fc.id
        `;
        if (!comps || comps.length === 0) {
          console.log('   (no hay componentes en formula_componentes para esa fórmula)');
        } else {
          for (const c of comps) {
            console.log('   - componente id:', c.id, 'materia_prima_id:', c.materia_prima_id, 'nombre:', c.producto_nombre || c.nombre || 'N/A', 'cantidad:', c.cantidad, 'unidad:', c.unidad);
          }
        }
      } else {
        console.log(' -> No tiene formula_id');
      }
    }
  } catch (err) {
    console.error('Error ejecutando consulta:', err && err.message ? err.message : err);
  } finally {
    process.exit(0);
  }
}

inspect();
