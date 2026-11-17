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

  describe('inicialización de permisos', () => {
    let sql;
    let usuarioModulos;
    let permisos;

    beforeEach(() => {
      jest.resetModules();
      sql = jest.fn(async () => []);
      sql.query = jest.fn(async () => []);
      jest.doMock('@neondatabase/serverless', () => ({ neon: () => sql }));
      usuarioModulos = require('../services/usuarioModulos');
      permisos = require('../services/permisos');
    });

    afterEach(() => {
      jest.dontMock('@neondatabase/serverless');
    });

    test('un reporte espera la migración y solicitudes simultáneas comparten la inicialización', async () => {
      let terminarMigracion;
      sql.query.mockImplementation((query) => {
        if (query.startsWith('UPDATE usuario_modulos')) {
          return new Promise((resolve) => { terminarMigracion = resolve; });
        }
        return Promise.resolve([]);
      });
      sql.mockImplementation(async (strings) => {
        if (strings.join('').includes('SELECT * FROM usuario_modulos')) {
          return [{ perm_rep_clientes: true }];
        }
        return [];
      });

      const primera = permisos.tienePermiso({ id: 1, rol: 'user' }, 'rep_clientes');
      const segunda = permisos.tienePermiso({ id: 1, rol: 'user' }, 'rep_clientes');
      while (!terminarMigracion) await new Promise((resolve) => setImmediate(resolve));
      expect(sql.mock.calls.some(([strings]) => strings.join('').includes('SELECT *'))).toBe(false);
      terminarMigracion([]);

      await expect(Promise.all([primera, segunda])).resolves.toEqual([true, true]);
      expect(sql.query.mock.calls.filter(([query]) => query.startsWith('UPDATE usuario_modulos'))).toHaveLength(1);
    });

    test('la migración solo usa columnas antiguas en la primera versión y no repite filas migradas', async () => {
      await usuarioModulos.asegurarUsuarioModulos();
      const [query] = sql.query.mock.calls.find(([text]) => text.startsWith('UPDATE usuario_modulos'));

      expect(query).toContain("COALESCE(u.permisos_version, 1) < 2\n    AND COALESCE(u.permisos, '{}'::jsonb) = '{}'::jsonb");
      expect(query).toContain('WHERE COALESCE(u.permisos_version, 1) < 4');
      expect(query).toContain('"perm_rep_clientes"');
      expect(query).toContain('"perm_produccion"');
    });

    test('un fallo de migración se informa y se puede reintentar', async () => {
      sql.query.mockRejectedValueOnce(new Error('fallo de base'));
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      try {
        await permisos.requierePermiso('rep_clientes')({ user: { id: 1, rol: 'user' } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(500);
        await expect(usuarioModulos.asegurarUsuarioModulos()).resolves.toBeUndefined();
      } finally {
        errorLog.mockRestore();
      }
    });

    test('guardar y consultar permisos conserva el formato del panel', async () => {
      const express = require('express');
      const request = require('supertest');
      let fila;
      sql.mockImplementation(async (strings) => {
        if (strings.join('').includes('SELECT * FROM usuario_modulos')) return fila ? [fila] : [];
        return [];
      });
      sql.query.mockImplementation(async (query, values) => {
        if (!query.startsWith('INSERT INTO usuario_modulos')) return [];
        fila = { usuario_id: values[0] };
        usuarioModulos.MODULOS_KEYS.forEach((clave, index) => {
          fila[columnaPermiso(clave)] = values[index + 1];
        });
        return [fila];
      });
      const app = express();
      app.use(express.json(), (req, res, next) => {
        req.user = { id: 1, rol: 'admin' };
        next();
      }, require('../routes/users'));

      const guardar = await request(app).put('/2/modulos').send({
        dashboard: true,
        rep_clientes: true,
        produccion: false,
      });
      expect(guardar.status).toBe(200);
      expect(guardar.body.modulos).toEqual(['dashboard', 'rep_clientes']);
      const consultar = await request(app).get('/2/modulos');
      expect(consultar.status).toBe(200);
      expect(consultar.body.modulos).toEqual(['dashboard', 'rep_clientes']);
      expect(fila.perm_produccion).toBe(false);
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
