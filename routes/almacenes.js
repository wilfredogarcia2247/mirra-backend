const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarAlmacen(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  // Tipo soportado: solo 'Venta' o 'Interno'
  if (!body.tipo || !['Venta', 'Interno'].includes(body.tipo)) return 'Tipo inválido';
  if (body.es_materia_prima != null && typeof body.es_materia_prima !== 'boolean') return 'es_materia_prima debe ser booleano';
  if (body.ubicacion && typeof body.ubicacion !== 'string') return 'Ubicacion inválida';
  if (body.responsable && typeof body.responsable !== 'string') return 'Responsable inválido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const result = await sql`SELECT * FROM almacenes`;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarAlmacen(req.body);
  if (error) return res.status(400).json({ error });
  try {
      const { nombre, tipo, ubicacion, responsable, es_materia_prima } = req.body;
      // Mantener compatibilidad: si se envía es_materia_prima, sincronizar tipo
      // ahora true => 'Interno', false => 'Venta'
      const finalTipo = es_materia_prima === true ? 'Interno' : (es_materia_prima === false ? 'Venta' : tipo);
      const result = await sql`
        INSERT INTO almacenes (nombre, tipo, ubicacion, responsable, es_materia_prima)
        VALUES (${nombre}, ${finalTipo}, ${ubicacion}, ${responsable}, ${es_materia_prima || false}) RETURNING *
      `;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await sql`SELECT * FROM almacenes WHERE id = ${req.params.id}`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const error = validarAlmacen(req.body);
  if (error) return res.status(400).json({ error });
  try {
      const { nombre, tipo, ubicacion, responsable, es_materia_prima } = req.body;
      // Si intentan cambiar el flag es_materia_prima y el almacen tiene movimientos, bloquear
      if (es_materia_prima != null) {
        const movimientos = await sql`SELECT COUNT(*)::int AS c FROM inventario_movimientos WHERE almacen_id = ${req.params.id}`;
        const movCount = movimientos && movimientos[0] ? Number(movimientos[0].c) : 0;
        if (movCount > 0) return res.status(400).json({ error: 'No se puede cambiar el tipo de almacén: existen movimientos registrados' });
      }
      const finalTipo = es_materia_prima === true ? 'MateriaPrima' : (es_materia_prima === false ? 'Venta' : tipo);
      const result = await sql`
        UPDATE almacenes SET nombre=${nombre}, tipo=${finalTipo}, ubicacion=${ubicacion}, responsable=${responsable}, es_materia_prima=${es_materia_prima != null ? es_materia_prima : sql`es_materia_prima`} 
        WHERE id = ${req.params.id} RETURNING *
      `;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    // Verificar existencia de stock en este almacén
    const stockRows = await sql`SELECT COALESCE(SUM(stock_fisico - stock_comprometido),0) AS disponible FROM inventario WHERE almacen_id = ${req.params.id}`;
    const disponible = stockRows && stockRows[0] ? Number(stockRows[0].disponible) : 0;
    if (disponible > 0) return res.status(400).json({ error: 'No se puede eliminar el almacén: existe stock en inventario' });

    const result = await sql`DELETE FROM almacenes WHERE id = ${req.params.id} RETURNING *`;
    if (result.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, almacen: result[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
