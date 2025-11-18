const express = require('express');
const router = express.Router();

// Contactos eliminados en la base de datos. Este stub evita errores 500
// en instalaciones donde la ruta pueda seguir montada accidentalmente.
router.use((req, res) => {
  res.status(404).json({ error: 'Recurso de contactos removido' });
});

module.exports = router;
