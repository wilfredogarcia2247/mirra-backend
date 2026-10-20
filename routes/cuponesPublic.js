const express = require('express');
const router = express.Router();
const { validarCupon } = require('../services/cupones');

// Endpoint público para validar un cupón sin autenticación (usado en el carrito del sitio público)
router.post('/validar', async (req, res) => {
  const codigo = String(req.body?.codigo || '').trim();

  const resultado = await validarCupon(codigo);
  if (!resultado.ok) {
    return res.status(resultado.status || 404).json({ valid: false, error: resultado.error });
  }

  const cupon = resultado.cupon;
  return res.json({
    valid: true,
    id: cupon.id,
    codigo: cupon.codigo,
    descuento_porcentaje: cupon.descuento_porcentaje,
    descripcion: cupon.descripcion,
    es_global: cupon.es_global,
    colaborador_nombre: cupon.colaborador_nombre,
  });
});

module.exports = router;
