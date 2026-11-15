const {
  columnaPermiso,
  permisosDesdeColumnas,
  valoresPermisos,
} = require('../services/permisosColumnas');

describe('permisos guardados en columnas', () => {
  const claves = ['dashboard', 'rep_cierre_diario', 'produccion'];

  test('convierte columnas habilitadas al formato de permisos del API', () => {
    const row = {
      perm_dashboard: true,
      perm_rep_cierre_diario: true,
      perm_produccion: false,
    };

    expect(permisosDesdeColumnas(row, claves)).toEqual({
      dashboard: true,
      rep_cierre_diario: true,
    });
  });

  test('solo guarda como habilitados los permisos booleanos true', () => {
    expect(valoresPermisos({ dashboard: true, rep_cierre_diario: 1 }, claves)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('maneja usuarios sin fila de permisos', () => {
    expect(permisosDesdeColumnas(undefined, claves)).toEqual({});
    expect(columnaPermiso('dashboard')).toBe('perm_dashboard');
  });
});
