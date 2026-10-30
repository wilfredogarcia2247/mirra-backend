const app = require('./app');
const { asegurarEsquemaDescuentoMayor } = require('./services/descuentoMayor');

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
  // Tabla de reglas y columnas del descuento al mayor: se crean solas si faltan
  asegurarEsquemaDescuentoMayor().catch((error) => {
    console.error('No se pudo preparar el descuento al mayor:', error.message || error);
  });
});
