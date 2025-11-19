const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarCategoria(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  if (body.descripcion != null && typeof body.descripcion !== 'string')
    return 'Descripcion inválida';
  return null;
}

// Listar categorías
router.get('/', async (req, res) => {
  try {
    // Traer categorías y para cada una agregar productos que estén en almacenes de tipo 'venta'
    const cats = await sql`SELECT * FROM categorias ORDER BY nombre`;
    const categorias = [];
    for (const c of cats || []) {
      const productos = await sql`
        SELECT p.id, p.nombre, p.precio_venta,
          COALESCE(SUM(i.stock_fisico - i.stock_comprometido),0) AS stock_disponible
        FROM productos p
        JOIN inventario i ON i.producto_id = p.id
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE p.categoria_id = ${c.id} AND a.tipo = 'venta'
        GROUP BY p.id, p.nombre, p.precio_venta
        HAVING COALESCE(SUM(i.stock_fisico - i.stock_comprometido),0) > 0
        ORDER BY p.nombre
      `;
      categorias.push({ ...c, productos: productos || [] });
    }
    res.json(categorias);
  } catch (err) {
    console.error('Error listando categorias:', err);
    res.status(500).json({ error: 'Error listando categorias' });
  }
});

// Crear categoría
router.post('/', async (req, res) => {
  const err = validarCategoria(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const { nombre, descripcion } = req.body;
    const inserted = await sql`
      INSERT INTO categorias (nombre, descripcion) VALUES (${nombre}, ${
      descripcion || null
    }) RETURNING *
    `;
    res.status(201).json(inserted && inserted[0] ? inserted[0] : null);
  } catch (e) {
    console.error('Error creando categoria:', e);
    if (e && e.code === '23505') return res.status(400).json({ error: 'Categoria ya existe' });
    res.status(500).json({ error: 'Error creando categoria' });
  }
});

// Obtener categoría por id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM categorias WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const c = rows[0];
    const productos = await sql`
      SELECT p.id, p.nombre, p.precio_venta,
        COALESCE(SUM(i.stock_fisico - i.stock_comprometido),0) AS stock_disponible
      FROM productos p
      JOIN inventario i ON i.producto_id = p.id
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE p.categoria_id = ${c.id} AND a.tipo = 'venta'
      GROUP BY p.id, p.nombre, p.precio_venta
      HAVING COALESCE(SUM(i.stock_fisico - i.stock_comprometido),0) > 0
      ORDER BY p.nombre
    `;
    res.json({ ...c, productos: productos || [] });
  } catch (e) {
    console.error('Error obteniendo categoria:', e);
    res.status(500).json({ error: 'Error obteniendo categoria' });
  }
});

// Actualizar categoría
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const err = validarCategoria(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const { nombre, descripcion } = req.body;
    const updated = await sql`
      UPDATE categorias SET nombre = ${nombre}, descripcion = ${
      descripcion || null
    } WHERE id = ${id} RETURNING *
    `;
    if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(updated[0]);
  } catch (e) {
    console.error('Error actualizando categoria:', e);
    if (e && e.code === '23505')
      return res.status(400).json({ error: 'Nombre de categoria ya en uso' });
    res.status(500).json({ error: 'Error actualizando categoria' });
  }
});

// Eliminar categoría
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar que no existan productos asociados
    const prodCount =
      await sql`SELECT COUNT(*)::int AS c FROM productos WHERE categoria_id = ${id}`;
    const c = prodCount && prodCount[0] ? Number(prodCount[0].c) : 0;
    if (c > 0)
      return res.status(400).json({ error: 'No se puede eliminar: existen productos asociados' });

    const deleted = await sql`DELETE FROM categorias WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ eliminado: true, categoria: deleted[0] });
  } catch (e) {
    console.error('Error eliminando categoria:', e);
    res.status(500).json({ error: 'Error eliminando categoria' });
  }
});

module.exports = router;
