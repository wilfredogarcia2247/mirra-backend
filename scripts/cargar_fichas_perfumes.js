// Carga las fichas sugeridas (scripts/fichas_perfumes_datos.js) como "Por revisar".
//
// Uso:
//   node scripts/cargar_fichas_perfumes.js --seco   -> solo muestra qué haría, no escribe nada
//   node scripts/cargar_fichas_perfumes.js          -> escribe en la base de DATABASE_URL
//
// Protecciones:
// - Cada perfume se busca por id Y nombre; si el id no coincide, se busca solo por nombre.
//   Si no se encuentra (o hay más de uno con ese nombre), se salta y se informa.
// - Nunca pisa una ficha ya marcada como revisada en el panel (solo le completa casa y año si los tiene vacíos).
// - Casa y año de lanzamiento del original salen de scripts/fichas_perfumes_casas.js.
// - Todo queda revisada=false: no se ve en la tienda hasta revisarlo en Productos > Ficha.
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const datos = require('./fichas_perfumes_datos');
const nombres = require('./fichas_perfumes_nombres.json');
const casas = require('./fichas_perfumes_casas');
const { normalizarFicha, asegurarColumnaFicha } = require('../services/fichaPerfume');

const SECO = process.argv.includes('--seco');
const sql = neon(process.env.DATABASE_URL);

const PARA = { m: 'mujer', h: 'hombre', u: 'unisex' };
const MOMENTO = { d: 'dia', n: 'noche', a: 'ambos' };
const DUR = { b: 'baja', m: 'media', a: 'alta' };
const ESTELA = { s: 'suave', n: 'se_nota', f: 'fuerte' };
const TEMP = { p: 'primavera', v: 'verano', o: 'otono', i: 'invierno' };
const lista = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);

function aFicha(id, [inspirado, salida, corazon, fondo, para, momento, familias, dur, estela, temps]) {
  const [casa, anio] = casas[id] || [];
  return normalizarFicha({
    inspirado_en: inspirado,
    casa,
    anio,
    notas: { salida: lista(salida), corazon: lista(corazon), fondo: lista(fondo) },
    para: PARA[para] || null,
    momento: MOMENTO[momento] || null,
    familias: lista(familias),
    duracion: DUR[dur] || null,
    estela: ESTELA[estela] || null,
    temporadas: lista(temps).map((t) => TEMP[t]).filter(Boolean),
    revisada: false,
  });
}

(async () => {
  if (!SECO) await asegurarColumnaFicha();
  const resumen = { cargadas: 0, ya_revisadas: 0, casa_completada: 0, no_encontradas: [], por_nombre: 0 };
  const tieneColumna = (await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'ficha'`).length > 0;

  for (const [idTexto, fila] of Object.entries(datos)) {
    const id = Number(idTexto);
    const nombre = nombres[idTexto];
    let prod = await sql`SELECT id FROM productos WHERE id = ${id} AND UPPER(TRIM(nombre)) = UPPER(TRIM(${nombre})) LIMIT 1`;
    if (!prod.length) {
      prod = await sql`SELECT id FROM productos WHERE UPPER(TRIM(nombre)) = UPPER(TRIM(${nombre}))`;
      if (prod.length !== 1) { resumen.no_encontradas.push(`${id} ${nombre}`); continue; }
      resumen.por_nombre += 1;
    }
    const destino = Number(prod[0].id);
    if (tieneColumna) {
      const actual = await sql`SELECT ficha FROM productos WHERE id = ${destino}`;
      const ficha = actual[0]?.ficha;
      if (ficha?.revisada === true) {
        // Ya revisada: no se pisa; solo se completan casa y año si están vacíos
        resumen.ya_revisadas += 1;
        const [casa, anio] = casas[idTexto] || [];
        if ((!ficha.casa && casa) || (!ficha.anio && anio)) {
          const completa = normalizarFicha({ ...ficha, casa: ficha.casa || casa, anio: ficha.anio || anio });
          if (!SECO) await sql`UPDATE productos SET ficha = ${JSON.stringify(completa)}::jsonb WHERE id = ${destino}`;
          resumen.casa_completada += 1;
        }
        continue;
      }
    }
    if (!SECO) {
      await sql`UPDATE productos SET ficha = ${JSON.stringify(aFicha(idTexto, fila))}::jsonb WHERE id = ${destino}`;
    }
    resumen.cargadas += 1;
  }

  console.log(SECO ? '--- PRUEBA (no se escribió nada) ---' : '--- Fichas cargadas como "Por revisar" ---');
  console.log(`Cargadas: ${resumen.cargadas}`);
  console.log(`Encontradas por nombre (id distinto): ${resumen.por_nombre}`);
  console.log(`Saltadas porque ya estaban revisadas: ${resumen.ya_revisadas}`);
  console.log(`  - de esas, se les completó casa/año: ${resumen.casa_completada}`);
  console.log(`No encontradas: ${resumen.no_encontradas.length}`);
  resumen.no_encontradas.forEach((n) => console.log('  -', n));
  const baja = Object.entries(datos).filter(([, f]) => !f[10]).map(([id]) => `${id} ${nombres[id]}`);
  console.log(`\nCon pocos datos públicos (revisar con más cuidado): ${baja.length}`);
  baja.forEach((n) => console.log('  -', n));
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
