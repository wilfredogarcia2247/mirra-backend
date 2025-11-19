const mongoose = require('mongoose');
const PedidoCompraSchema = new mongoose.Schema({
  // proveedor removed: purchases no longer reference a Proveedor model
  productos: [
    {
      producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
      cantidad: Number,
    },
  ],
  estado: { type: String, enum: ['Pendiente', 'Recibido'] },
  fecha: Date,
});
module.exports = mongoose.model('PedidoCompra', PedidoCompraSchema);
