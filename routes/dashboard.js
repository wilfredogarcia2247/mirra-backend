const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// GET /api/dashboard/stats
// Returns all dashboard KPIs + chart data + top products in a single round-trip
router.get('/stats', async (req, res) => {
  try {
    const [
      totalProductosRes,
      pedidosActivosRes,
      almacenesRes,
      ventasMesRes,
      ventasMensualesRes,
      topProductosRes,
    ] = await Promise.all([
      // Total productos activos
      sql`SELECT COUNT(*) AS total FROM productos`,

      // Pedidos pendientes
      sql`SELECT COUNT(*) AS total FROM pedidos_venta WHERE estado = 'Pendiente'`,

      // Total almacenes
      sql`SELECT COUNT(*) AS total FROM almacenes`,

      // Ventas del mes actual (pedidos completados)
      sql`
        SELECT COALESCE(SUM(pv.cantidad * COALESCE(pv.precio_venta, 0)), 0) AS total
        FROM pedidos_venta p
        JOIN pedido_venta_productos pv ON pv.pedido_venta_id = p.id
        WHERE p.estado IN ('Completado','Completada','Finalizado','Finalizada','Entregado','Pagado')
          AND DATE_TRUNC('month', p.fecha) = DATE_TRUNC('month', CURRENT_DATE)
      `,

      // Ventas por mes (últimos 12 meses) — ventas $ y nº pedidos
      sql`
        SELECT
          EXTRACT(MONTH FROM p.fecha)::int AS mes,
          EXTRACT(YEAR FROM p.fecha)::int AS anio,
          COALESCE(SUM(pv.cantidad * COALESCE(pv.precio_venta, 0)), 0) AS ventas,
          COUNT(DISTINCT p.id) AS pedidos
        FROM pedidos_venta p
        JOIN pedido_venta_productos pv ON pv.pedido_venta_id = p.id
        WHERE p.estado IN ('Completado','Completada','Finalizado','Finalizada','Entregado','Pagado')
          AND p.fecha >= DATE_TRUNC('year', CURRENT_DATE)
        GROUP BY mes, anio
        ORDER BY anio, mes
      `,

      // Top 6 productos más vendidos (por cantidad) en pedidos completados
      sql`
        SELECT
          pv.producto_id,
          COALESCE(pv.nombre_producto, prod.nombre, 'Desconocido') AS nombre,
          SUM(pv.cantidad) AS unidades,
          SUM(pv.cantidad * COALESCE(pv.precio_venta, 0)) AS ingresos
        FROM pedidos_venta p
        JOIN pedido_venta_productos pv ON pv.pedido_venta_id = p.id
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        WHERE p.estado IN ('Completado','Completada','Finalizado','Finalizada','Entregado','Pagado')
        GROUP BY pv.producto_id, COALESCE(pv.nombre_producto, prod.nombre, 'Desconocido')
        ORDER BY unidades DESC
        LIMIT 6
      `,
    ]);

    // Build monthly chart array (Jan–Dec for current year)
    const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const chartData = MONTH_NAMES.map((name, idx) => {
      const row = ventasMensualesRes.find((r) => Number(r.mes) === idx + 1);
      return {
        name,
        ventas: row ? Number(row.ventas) : 0,
        compras: row ? Number(row.pedidos) : 0,
      };
    });

    res.json({
      totalProductos: Number(totalProductosRes[0]?.total ?? 0),
      pedidosActivos: Number(pedidosActivosRes[0]?.total ?? 0),
      almacenes: Number(almacenesRes[0]?.total ?? 0),
      ventasMes: Number(ventasMesRes[0]?.total ?? 0),
      chartData,
      topProductos: topProductosRes.map((r) => ({
        id: r.producto_id,
        nombre: r.nombre,
        unidades: Number(r.unidades),
        ingresos: Number(r.ingresos),
      })),
    });
  } catch (err) {
    console.error('dashboard/stats error:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas del dashboard' });
  }
});

module.exports = router;
