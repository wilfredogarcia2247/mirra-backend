const { neon } = require('@neondatabase/serverless');
const { columnaPermiso } = require('./permisosColumnas');
const sql = neon(process.env.DATABASE_URL);

const MODULOS = [
  { grupo: 'General', items: [
    { key: 'dashboard', label: 'Dashboard' },
  ] },
  { grupo: 'Reportes de la tienda', items: [
    { key: 'rep_cierre_diario', label: 'Cierre diario' },
    { key: 'rep_pedidos_estado', label: 'Pedidos por estado' },
    { key: 'rep_inventario', label: 'Estado de inventario' },
    { key: 'rep_rotacion_inventario', label: 'Rotación de inventario' },
    { key: 'rep_historial_produccion', label: 'Historial de producción' },
    { key: 'rep_productos_favoritos', label: 'Productos favoritos' },
    { key: 'rep_compras', label: 'Compras y reposición' },
    { key: 'rep_entregas', label: 'Entregas y ciudades' },
  ] },
  { grupo: 'Reportes de dinero y clientes', items: [
    { key: 'rep_resumen_general', label: 'Cómo vamos' },
    { key: 'rep_ventas_periodo', label: 'Ventas por periodo' },
    { key: 'rep_ventas_metodo', label: 'Ventas por método' },
    { key: 'rep_ventas_presentacion', label: 'Ventas por presentación' },
    { key: 'rep_ticket_promedio', label: 'Ticket promedio' },
    { key: 'rep_rentabilidad', label: 'Rentabilidad' },
    { key: 'rep_clientes', label: 'Clientes y recompras' },
  ] },
  { grupo: 'Catálogo', items: [
    { key: 'marcas', label: 'Marcas' },
    { key: 'categorias', label: 'Categorías' },
    { key: 'productos', label: 'Productos' },
    { key: 'formulas', label: 'Fórmulas' },
  ] },
  { grupo: 'Operaciones', items: [
    { key: 'pedidos', label: 'Pedidos' },
    { key: 'almacenes', label: 'Almacenes' },
    { key: 'produccion', label: 'Producción' },
  ] },
  { grupo: 'Finanzas', items: [
    { key: 'tasas_cambio', label: 'Tasas de cambio' },
    { key: 'bancos', label: 'Bancos' },
    { key: 'pagos', label: 'Pagos' },
  ] },
  { grupo: 'Marketing', items: [
    { key: 'destacados', label: 'Destacados' },
    { key: 'cupones', label: 'Cupones' },
    { key: 'descuento_mayor', label: 'Descuento al mayor' },
    { key: 'avisos', label: 'Clientes esperando' },
  ] },
  { grupo: 'Sistema', items: [
    { key: 'usuarios', label: 'Usuarios' },
    { key: 'cintillo', label: 'Cintillo' },
    { key: 'sucursales', label: 'Sucursales' },
  ] },
];
const MODULOS_KEYS = MODULOS.flatMap((grupo) => grupo.items.map((item) => item.key));
const MODULOS_VIEJOS = ['dashboard', 'tasas_cambio', 'bancos', 'marcas', 'categorias', 'almacenes', 'productos', 'formulas', 'pedidos', 'usuarios'];
const REPORTES_TIENDA = ['rep_cierre_diario', 'rep_pedidos_estado', 'rep_inventario', 'rep_rotacion_inventario',
  'rep_historial_produccion', 'rep_productos_favoritos', 'rep_compras', 'rep_entregas'];
const PERMISOS_DERIVADOS = {
  produccion: 'almacenes',
  destacados: 'usuarios',
  cupones: 'usuarios',
  descuento_mayor: 'usuarios',
  avisos: 'usuarios',
  cintillo: 'usuarios',
  sucursales: 'usuarios',
};
const PERMISOS_VERSION = 4;

function consultaMigracion() {
  const viejo = MODULOS_VIEJOS
    .map((clave) => `'${clave}', COALESCE(to_jsonb(u)->'${clave}', 'false'::jsonb)`)
    .join(', ');
  const origen = `(CASE WHEN COALESCE(u.permisos_version, 1) < 2
    AND COALESCE(u.permisos, '{}'::jsonb) = '{}'::jsonb
    THEN jsonb_build_object(${viejo}) ELSE COALESCE(u.permisos, '{}'::jsonb) END)`;
  const habilitado = (clave) => `(${origen}->'${clave}' = 'true'::jsonb) IS TRUE`;
  const asignaciones = MODULOS_KEYS.map((clave) => {
    const condiciones = [habilitado(clave)];
    if (PERMISOS_DERIVADOS[clave]) {
      condiciones.push(`(COALESCE(u.permisos_version, 1) < 2 AND ${habilitado(PERMISOS_DERIVADOS[clave])})`);
    }
    if (REPORTES_TIENDA.includes(clave)) {
      condiciones.push(`(COALESCE(u.permisos_version, 1) < 3 AND (${habilitado('reportes')} OR
        (COALESCE(u.permisos_version, 1) < 2 AND ${habilitado('dashboard')})))`);
    }
    return `"${columnaPermiso(clave)}" = (${condiciones.join(' OR ')})`;
  });
  return `UPDATE usuario_modulos AS u SET ${asignaciones.join(', ')}, permisos_version = ${PERMISOS_VERSION}
    WHERE COALESCE(u.permisos_version, 1) < ${PERMISOS_VERSION}`;
}

let asegurando;
function asegurarUsuarioModulos() {
  if (!asegurando) {
    asegurando = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS usuario_modulos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER UNIQUE,
        permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
        permisos_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`ALTER TABLE usuario_modulos ADD COLUMN IF NOT EXISTS permisos jsonb NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE usuario_modulos ADD COLUMN IF NOT EXISTS permisos_version INTEGER NOT NULL DEFAULT 1`;
      const columnas = MODULOS_KEYS.map((clave) =>
        `ADD COLUMN IF NOT EXISTS "${columnaPermiso(clave)}" BOOLEAN NOT NULL DEFAULT FALSE`,
      ).join(', ');
      await sql.query(`ALTER TABLE usuario_modulos ${columnas}`);
      await sql.query(consultaMigracion());
    })().catch((error) => {
      asegurando = undefined;
      throw error;
    });
  }
  return asegurando;
}

module.exports = { MODULOS, MODULOS_KEYS, PERMISOS_VERSION, asegurarUsuarioModulos };
