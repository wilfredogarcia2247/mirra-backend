// Pedidos de compra: removido
// Archivo mantenido como stub para evitar 500s si aún está montado.
const express = require('express');
const router = express.Router();

router.use((req, res) => {
  res.status(404).json({ error: 'Funcionalidad de pedidos de compra eliminada' });
});

module.exports = router;
