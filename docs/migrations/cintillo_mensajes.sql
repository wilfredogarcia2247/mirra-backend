CREATE TABLE IF NOT EXISTS cintillo_mensajes (
  id SERIAL PRIMARY KEY,
  texto VARCHAR(280) NOT NULL CHECK (char_length(trim(texto)) > 0),
  orden INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cintillo_mensajes ADD COLUMN IF NOT EXISTS emoji TEXT NOT NULL DEFAULT '';

UPDATE cintillo_mensajes
SET texto = LEFT(emoji || ' ' || texto, 280)
WHERE char_length(trim(emoji)) > 0;

ALTER TABLE cintillo_mensajes DROP COLUMN IF EXISTS emoji;

CREATE INDEX IF NOT EXISTS idx_cintillo_mensajes_activos_orden
  ON cintillo_mensajes (orden, id)
  WHERE activo = TRUE;