const mongoose = require('mongoose');
const ProductoSchema = new mongoose.Schema({
  nombre: String,
  unidad: String,
  image_url: String,
  stock: Number,
  costo: Number,
  precioVenta: Number
});
module.exports = mongoose.model('Producto', ProductoSchema);
