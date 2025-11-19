#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Insertando datos de prueba: tamanos y precio_productos (demo)');

  try {
    // Usaremos el producto de ejemplo creado en initNeonDB (id 7: 'Perfume Floral N°5 - 50ml')
    const demoProductoId = 7;


    // Insertar precios calculados de ejemplo (si no existen)

    console.log('Seed completado.');
    process.exit(0);
  } catch (err) {
    console.error('Error insertando seed:', err);
    process.exit(2);
  }
}

main();
  // Archivo deshabilitado: la tabla `tamanos` fue eliminada
  // Este script era responsable de insertar datos de prueba en `tamanos`.
  // Eliminado por petición: conservar como stub para historial.
  console.log('seed_tamanos_testdata.js: script deshabilitado (tamanos eliminado)');
