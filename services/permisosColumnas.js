const PREFIJO_COLUMNA_PERMISO = 'perm_';

function columnaPermiso(clave) {
  return `${PREFIJO_COLUMNA_PERMISO}${clave}`;
}

function permisosDesdeColumnas(row, claves) {
  if (!row) return {};
  return Object.fromEntries(
    claves
      .filter((clave) => row[columnaPermiso(clave)] === true)
      .map((clave) => [clave, true]),
  );
}

function valoresPermisos(permisos, claves) {
  return claves.map((clave) => permisos[clave] === true);
}

module.exports = { columnaPermiso, permisosDesdeColumnas, valoresPermisos };
