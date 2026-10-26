ALTER TABLE pedidos_venta
  ADD COLUMN IF NOT EXISTS completado_en TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_pedidos_venta_completado_en
  ON pedidos_venta (completado_en);
