const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function getFormaNombre(forma_pago_id) {
  try {
    const rows = await sql`SELECT nombre FROM formas_pago WHERE id = ${forma_pago_id}`;
    return rows && rows[0] && rows[0].nombre;
  } catch (e) {
    return null;
  }
}

function validateDetallesByNombre(nombre, detalles) {
  // detalles es un objeto JSON
  if (!nombre) return 'Forma de pago desconocida';
  if (nombre === 'Pago Movil' || nombre === 'Pago Móvil' || nombre.toLowerCase() === 'pago movil') {
    if (!detalles || typeof detalles !== 'object') return 'detalles requerido para Pago Movil';
    if (!detalles.numero_telefono) return 'Pago Movil: numero_telefono requerido';
    if (!detalles.documento) return 'Pago Movil: documento (cedula o RIF) requerido';
  }
  if (nombre === 'Transferencia') {
    if (!detalles || typeof detalles !== 'object') return 'detalles requerido para Transferencia';
    if (!detalles.numero_cuenta) return 'Transferencia: numero_cuenta requerido';
    if (!detalles.documento) return 'Transferencia: documento (cedula o RIF) requerido';
  }
  // Efectivo no requiere detalles obligatorios
  return null;
}

function validarBanco(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  if (body.formas_pago && !Array.isArray(body.formas_pago))
    return 'formas_pago debe ser un arreglo si se envía';
  if (body.moneda && typeof body.moneda !== 'string') return 'moneda inválida';
  return null;
}

router.get('/', async (req, res) => {
  try {
    // Intentar devolver bancos con sus formas de pago embebidas (id, nombre, detalles)
    // Usamos una agregación JSON; si la tabla de asociación no existe, hacemos fallback a SELECT simple
    try {
      const rows = await sql`
        SELECT b.*, COALESCE(json_agg(json_build_object('id', f.id, 'nombre', f.nombre, 'detalles', bf.detalles)) FILTER (WHERE f.id IS NOT NULL), '[]') AS formas_pago
        FROM bancos b
        LEFT JOIN banco_formas_pago bf ON bf.banco_id = b.id
        LEFT JOIN formas_pago f ON f.id = bf.forma_pago_id
        GROUP BY b.id
        ORDER BY b.id
      `;
      return res.json(rows || []);
    } catch (e) {
      // Fallback conservador: retornar bancos sin formas si la agregación falla (p. ej. tabla no creada)
      const result = await sql`SELECT * FROM bancos`;
      return res.json(result || []);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarBanco(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, formas_pago, moneda } = req.body;
    // Validar formas_pago si vienen
    if (formas_pago && Array.isArray(formas_pago)) {
      for (const fp of formas_pago) {
        if (!fp.forma_pago_id)
          return res.status(400).json({ error: 'forma_pago_id es requerido en formas_pago' });
        const nombreForma = await getFormaNombre(fp.forma_pago_id);
        if (!nombreForma)
          return res.status(400).json({ error: `Forma de pago id=${fp.forma_pago_id} no existe` });
        const v = validateDetallesByNombre(nombreForma, fp.detalles);
        if (v) return res.status(400).json({ error: v });
      }
    }
    // Crear banco
    let banco;
    try {
      const result = await sql`INSERT INTO bancos (nombre, moneda) VALUES (${nombre}, ${
        moneda || null
      }) RETURNING *`;
      banco = result[0];
    } catch (e) {
      // Fallback para entornos donde la columna moneda no existe
      try {
        const res2 = await sql`INSERT INTO bancos (nombre) VALUES (${nombre}) RETURNING *`;
        banco = res2[0];
      } catch (e2) {
        throw e; // rethrow original
      }
    }
    // Insertar asociaciones validadas
    if (formas_pago && Array.isArray(formas_pago)) {
      // Verificar si la tabla existe en esta BD (por entornos donde initNeonDB no se ejecutó)
      try {
        const reg = await sql`SELECT to_regclass('public.banco_formas_pago') as t`;
        const exists = reg && reg[0] && reg[0].t;
        if (exists) {
          for (const fp of formas_pago) {
            try {
              await sql`INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles) VALUES (${banco.id}, ${fp.forma_pago_id}, ${fp.detalles})`;
            } catch (e) {
              // si falla por constraint, ignorar la fila individual
            }
          }
        }
      } catch (e) {
        // Si falla la comprobación, ignorar inserciones adicionales
      }
    }
    try {
      const formas =
        await sql`SELECT f.id, f.nombre, bf.detalles FROM banco_formas_pago bf JOIN formas_pago f ON f.id = bf.forma_pago_id WHERE bf.banco_id = ${banco.id}`;
      banco.formas_pago = formas || [];
    } catch (e) {
      banco.formas_pago = [];
    }
    res.status(201).json(banco);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM bancos WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Banco no encontrado' });
    const banco = rows[0];
    // Obtener las formas de pago y detalles asociados
    try {
      const formas =
        await sql`SELECT f.id, f.nombre, bf.detalles FROM banco_formas_pago bf JOIN formas_pago f ON f.id = bf.forma_pago_id WHERE bf.banco_id = ${id}`;
      banco.formas_pago = formas || [];
    } catch (e) {
      banco.formas_pago = [];
    }
    res.json(banco);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const error = validarBanco(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, moneda } = req.body;
    const updated = await sql`UPDATE bancos SET nombre = ${nombre} WHERE id = ${id} RETURNING *`;
    if (!updated || updated.length === 0)
      return res.status(404).json({ error: 'Banco no encontrado' });
    const banco = updated[0];
    // Si vienen formas de pago, validarlas y reemplazarlas (borramos y volvemos a insertar)
    const formas_pago = req.body.formas_pago;
    if (formas_pago && Array.isArray(formas_pago)) {
      // validar primero
      for (const fp of formas_pago) {
        if (!fp.forma_pago_id)
          return res.status(400).json({ error: 'forma_pago_id es requerido en formas_pago' });
        const nombreForma = await getFormaNombre(fp.forma_pago_id);
        if (!nombreForma)
          return res.status(400).json({ error: `Forma de pago id=${fp.forma_pago_id} no existe` });
        const v = validateDetallesByNombre(nombreForma, fp.detalles);
        if (v) return res.status(400).json({ error: v });
      }
      try {
        const reg = await sql`SELECT to_regclass('public.banco_formas_pago') as t`;
        const exists = reg && reg[0] && reg[0].t;
        if (exists) {
          await sql`DELETE FROM banco_formas_pago WHERE banco_id = ${id}`;
          for (const fp of formas_pago) {
            try {
              await sql`INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles) VALUES (${id}, ${fp.forma_pago_id}, ${fp.detalles})`;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    // Devolver con formas actualizadas
    try {
      const formas =
        await sql`SELECT f.id, f.nombre, bf.detalles FROM banco_formas_pago bf JOIN formas_pago f ON f.id = bf.forma_pago_id WHERE bf.banco_id = ${id}`;
      banco.formas_pago = formas || [];
    } catch (e) {
      banco.formas_pago = [];
    }
    // Actualizar el campo moneda si fue enviado
    try {
      await sql`UPDATE bancos SET moneda = ${moneda || null} WHERE id = ${id}`;
      const refreshed = await sql`SELECT * FROM bancos WHERE id = ${id}`;
      return res.json(refreshed && refreshed[0] ? refreshed[0] : banco);
    } catch (e) {
      // Si la actualización falla, devolver el banco original con formas
      return res.json(banco);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar uso en cliente_bancos (si la tabla existe)
    try {
      const tbl =
        await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cliente_bancos' LIMIT 1`;
      if (tbl && tbl.length > 0) {
        const refs =
          await sql`SELECT COUNT(*)::int AS c FROM cliente_bancos WHERE banco_id = ${id}`;
        const count = (refs && refs[0] && Number(refs[0].c)) || 0;
        if (count > 0)
          return res.status(400).json({ error: 'No se puede eliminar: banco asociado a clientes' });
      }
    } catch (e) {
      // Si la tabla no existe, permitir eliminación
    }
    const deleted = await sql`DELETE FROM bancos WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0)
      return res.status(404).json({ error: 'Banco no encontrado' });
    res.json({ success: true, banco: deleted[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
