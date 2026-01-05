const app = require('./app');

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
