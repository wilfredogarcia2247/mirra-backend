const express = require('express');
const router = express.Router();

// Cliente-bancos eliminada en la base de datos. Stub seguro para evitar
// errores en rutas no desmontadas.
router.use((req, res) => {
  res.status(404).json({ error: 'Recurso de cliente-bancos removido' });
});

module.exports = router;
