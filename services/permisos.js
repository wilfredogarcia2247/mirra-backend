// Revisa en el servidor los permisos por pantalla (columnas usuario_modulos.perm_*).
// El admin pasa siempre; los demás solo si tienen la clave marcada.
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { columnaPermiso } = require('./permisosColumnas');
const { asegurarUsuarioModulos } = require('./usuarioModulos');

async function tienePermiso(user, clave) {
  if (!user) return false;
  if (String(user.rol || '').toLowerCase() === 'admin') return true;
  const id = Number(user.id);
  if (!Number.isFinite(id)) return false;
  await asegurarUsuarioModulos();
  const rows = await sql`SELECT * FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
  return !!(rows && rows[0] && rows[0][columnaPermiso(clave)] === true);
}

// Middleware: corta con 403 si el usuario no tiene la clave
function requierePermiso(clave) {
  return async (req, res, next) => {
    try {
      if (await tienePermiso(req.user, clave)) return next();
      return res.status(403).json({ error: 'No tienes permiso para ver este reporte' });
    } catch (error) {
      console.error('Error verificando permisos:', error);
      return res.status(500).json({ error: 'Error verificando permisos' });
    }
  };
}

module.exports = { tienePermiso, requierePermiso };
