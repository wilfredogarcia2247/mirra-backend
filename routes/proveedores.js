const express = require('express');
const router = express.Router();

// Ruta de proveedores removida por decisión del proyecto.
// Este archivo actúa como stub seguro: no accede a la base de datos
// y devuelve 404 para cualquier petición.
router.use((req, res) => {
  res.status(404).json({ error: 'Recurso de proveedores removido' });
});

module.exports = router;
