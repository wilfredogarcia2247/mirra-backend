const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarMarca(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  if (body.descripcion != null && typeof body.descripcion !== 'string') return 'Descripcion inválida';
  return null;
}

// Listar marcas
router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM marcas ORDER BY nombre`;
    res.json(rows || []);
  } catch (err) {
    console.error('Error listando marcas:', err);
    res.status(500).json({ error: 'Error listando marcas' });
  }
});

// Crear marca
router.post('/', async (req, res) => {
  const err = validarMarca(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const { nombre, descripcion } = req.body;
    const inserted = await sql`
      INSERT INTO marcas (nombre, descripcion) VALUES (${nombre}, ${descripcion || null}) RETURNING *
    `;
    res.status(201).json(inserted && inserted[0] ? inserted[0] : null);
  } catch (e) {
    console.error('Error creando marca:', e);
    if (e && e.code === '23505') return res.status(400).json({ error: 'Marca ya existe' });
    res.status(500).json({ error: 'Error creando marca' });
  }
});

// Obtener marca por id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM marcas WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('Error obteniendo marca:', e);
    res.status(500).json({ error: 'Error obteniendo marca' });
  }
});

// Actualizar marca
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const err = validarMarca(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const { nombre, descripcion } = req.body;
    const updated = await sql`
      UPDATE marcas SET nombre = ${nombre}, descripcion = ${descripcion || null} WHERE id = ${id} RETURNING *
    `;
    if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(updated[0]);
  } catch (e) {
    console.error('Error actualizando marca:', e);
    if (e && e.code === '23505') return res.status(400).json({ error: 'Nombre de marca ya en uso' });
    res.status(500).json({ error: 'Error actualizando marca' });
  }
});

// Eliminar marca
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar que no existan productos asociados
    const prodCount = await sql`SELECT COUNT(*)::int AS c FROM productos WHERE marca_id = ${id}`;
    const c = prodCount && prodCount[0] ? Number(prodCount[0].c) : 0;
    if (c > 0) return res.status(400).json({ error: 'No se puede eliminar: existen productos asociados' });

    const deleted = await sql`DELETE FROM marcas WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, marca: deleted[0] });
  } catch (e) {
    console.error('Error eliminando marca:', e);
    res.status(500).json({ error: 'Error eliminando marca' });
  }
});

module.exports = router;
