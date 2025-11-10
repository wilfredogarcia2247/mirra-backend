require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  const id = 8;
  const image_url = "https://images.pexels.com/photos/3059609/pexels-photo-3059609.jpeg?auto=compress&cs=tinysrgb&w=750";
  console.log('Actualizando producto id=', id);
  const updated = await sql`
    UPDATE productos SET image_url=${image_url} WHERE id = ${id} RETURNING id, nombre, image_url
  `;
  if (!updated || updated.length === 0) {
    console.error('No se encontró el producto o no se actualizó.');
    process.exitCode = 2;
    return;
  }
  console.log('Resultado:', updated[0]);
}

run().catch(err => {
  console.error('Error en actualización:', err);
  process.exitCode = 1;
});
