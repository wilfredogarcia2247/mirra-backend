const mongoose = require('mongoose');
const AlmacenSchema = new mongoose.Schema({
  nombre: String,
  tipo: { type: String, enum: ['venta', 'interno'] },
  ubicacion: { type: String },
  responsable: { type: String }
});
module.exports = mongoose.model('Almacen', AlmacenSchema);
