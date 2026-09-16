const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function clientesTableExists() {
    try {
        const rows = await sql`SELECT to_regclass('public.clientes') AS exists`;
        return !!(rows && rows[0] && rows[0].exists);
    } catch (error) {
        return false;
    }
}

function normalizeCedula(value) {
    if (value == null) return '';
    return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeClientePayload(body = {}) {
    const nombre = String(body.nombre || '').trim();
    const telefono = String(body.telefono || '').trim();
    const cedula = normalizeCedula(body.cedula);
    const email = String(body.email || '').trim() || null;
    const direccion = String(body.direccion || '').trim() || null;
    const ciudad = String(body.ciudad || '').trim() || null;

    return {
        nombre,
        telefono,
        cedula,
        email,
        direccion,
        ciudad,
    };
}

async function findClienteByCedula(cedula) {
    const cleanCedula = normalizeCedula(cedula);
    if (!cleanCedula) return null;
    if (!(await clientesTableExists())) return null;

    const rows = await sql`
    SELECT *
    FROM clientes
    WHERE UPPER(REGEXP_REPLACE(cedula, '[^A-Z0-9]', '', 'g')) = ${cleanCedula}
    LIMIT 1
  `;

    return rows && rows[0] ? rows[0] : null;
}

async function resolveClienteFromBody(body = {}) {
    const payload = normalizeClientePayload(body);
    const clienteIdFromBody = body.cliente_id != null && body.cliente_id !== ''
        ? Number(body.cliente_id)
        : null;

    if (clienteIdFromBody != null && Number.isFinite(clienteIdFromBody)) {
        if (!(await clientesTableExists())) {
            return {
                cliente_id: null,
                nombre_cliente: payload.nombre || body.nombre_cliente || null,
                telefono: payload.telefono || body.telefono || null,
                cedula: payload.cedula || normalizeCedula(body.cedula) || null,
            };
        }

        const rows = await sql`SELECT id, nombre, telefono, cedula FROM clientes WHERE id = ${clienteIdFromBody} LIMIT 1`;
        if (!rows || rows.length === 0) {
            const err = new Error('cliente_id no existe');
            err.status = 400;
            throw err;
        }
        return {
            cliente_id: clienteIdFromBody,
            nombre_cliente: payload.nombre || body.nombre_cliente || rows[0].nombre || null,
            telefono: payload.telefono || body.telefono || rows[0].telefono || null,
            cedula: payload.cedula || normalizeCedula(body.cedula) || rows[0].cedula || null,
        };
    }

    const cedula = payload.cedula || normalizeCedula(body.cedula);
    if (!cedula) {
        return {
            cliente_id: null,
            nombre_cliente: payload.nombre || body.nombre_cliente || null,
            telefono: payload.telefono || body.telefono || null,
            cedula: null,
        };
    }

    if (!(await clientesTableExists())) {
        return {
            cliente_id: null,
            nombre_cliente: payload.nombre || body.nombre_cliente || null,
            telefono: payload.telefono || body.telefono || null,
            cedula,
        };
    }

    const existing = await findClienteByCedula(cedula);
    if (existing) {
        return {
            cliente_id: Number(existing.id),
            nombre_cliente: payload.nombre || existing.nombre || body.nombre_cliente || null,
            telefono: payload.telefono || existing.telefono || body.telefono || null,
            cedula: existing.cedula || cedula,
        };
    }

    if (!payload.nombre && !payload.telefono) {
        return {
            cliente_id: null,
            nombre_cliente: body.nombre_cliente || null,
            telefono: body.telefono || null,
            cedula,
        };
    }

    const inserted = await sql`
    INSERT INTO clientes (nombre, telefono, cedula, email, direccion, ciudad)
    VALUES (${payload.nombre || body.nombre_cliente || 'Cliente'}, ${payload.telefono || body.telefono || null}, ${cedula}, ${payload.email || null}, ${payload.direccion || null}, ${payload.ciudad || null})
    RETURNING *
  `;

    const cliente = inserted && inserted[0] ? inserted[0] : null;
    if (!cliente) {
        const err = new Error('No se pudo crear el cliente');
        err.status = 500;
        throw err;
    }

    return {
        cliente_id: Number(cliente.id),
        nombre_cliente: cliente.nombre || payload.nombre || body.nombre_cliente || null,
        telefono: cliente.telefono || payload.telefono || body.telefono || null,
        cedula: cliente.cedula || cedula,
    };
}

router.get('/lookup', async (req, res) => {
    try {
        const cedula = normalizeCedula(req.query.cedula);
        if (!cedula) return res.status(400).json({ error: 'cedula requerida' });

        if (!(await clientesTableExists())) {
            return res.status(200).json({ exists: false, cliente: null, cedula, table_missing: true });
        }

        const cliente = await findClienteByCedula(cedula);
        return res.json({ exists: !!cliente, cliente: cliente || null, cedula, table_missing: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/lookup-or-create', async (req, res) => {
    try {
        const body = normalizeClientePayload(req.body);
        const cedula = body.cedula;
        if (!cedula) return res.status(400).json({ error: 'cedula requerida' });

        if (!(await clientesTableExists())) {
            return res.status(200).json({ exists: false, cliente: null, table_missing: true, cedula });
        }

        const existing = await findClienteByCedula(cedula);
        if (existing) {
            return res.status(200).json({ exists: true, cliente: existing, table_missing: false });
        }

        if (!body.nombre) return res.status(400).json({ error: 'nombre requerido para crear cliente' });

        const inserted = await sql`
      INSERT INTO clientes (nombre, telefono, cedula, email, direccion, ciudad)
      VALUES (${body.nombre}, ${body.telefono || null}, ${cedula}, ${body.email || null}, ${body.direccion || null}, ${body.ciudad || null})
      RETURNING *
    `;

        return res.status(201).json({ exists: false, cliente: inserted && inserted[0] ? inserted[0] : null, table_missing: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/resumen', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 10);
        const rows = await sql`
      SELECT c.id,
             c.nombre,
             c.cedula,
             c.telefono,
             COUNT(DISTINCT pv.id)::int AS total_pedidos,
             COALESCE(SUM(pvp.cantidad * COALESCE(pvp.precio_venta, 0)), 0)::numeric AS total_gastado,
             MAX(pv.fecha) AS ultima_compra
      FROM clientes c
      LEFT JOIN pedidos_venta pv ON pv.cliente_id = c.id
      LEFT JOIN pedido_venta_productos pvp ON pvp.pedido_venta_id = pv.id
      GROUP BY c.id, c.nombre, c.cedula, c.telefono
      ORDER BY total_pedidos DESC, total_gastado DESC, c.nombre ASC
      LIMIT ${Number.isFinite(limit) && limit > 0 ? limit : 10}
    `;
        return res.json(rows || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 50);
        const rows = await sql`
      SELECT *
      FROM clientes
      ORDER BY id DESC
      LIMIT ${Number.isFinite(limit) && limit > 0 ? limit : 50}
    `;
        return res.json(rows || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

        const rows = await sql`SELECT * FROM clientes WHERE id = ${id} LIMIT 1`;
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        return res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
module.exports.normalizeCedula = normalizeCedula;
module.exports.findClienteByCedula = findClienteByCedula;
module.exports.resolveClienteFromBody = resolveClienteFromBody;
