// Momento, duración, estela y temporada calculados con reglas fijas a partir de los ingredientes de
// cada perfume y la concentración de Mirra (~33 % de esencia: 10 g/30 ml, 20 g/60 ml, 33 g/100 ml).
// Así todos los perfumes se miden con la misma vara, no con opiniones sobre el original.
//
// 1) Carácter principal = primera familia del perfume:
//    fresco (cítrico/acuático/fresco) · ligero (floral/frutal) · equilibrado (amaderado/especiado) · cálido (oriental/gourmand/dulce con fondo pesado)
// 2) Notas pesadas (vainilla, ámbar, oud, pachulí, tonka, cuero, tabaco, resinas, caramelo, canela...) suben intensidad.
// 3) Fijadores de fondo (los anteriores + almizcle, maderas, musgo, vetiver...) sostienen la duración.

const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cuenta = (lista, palabras) => lista.filter((n) => palabras.some((p) => sinTilde(n).includes(p))).length;

const PESADOS = ['vainilla', 'tonka', 'ambar', 'ambroxan', 'ambarwood', 'amberwood', 'oud', 'agar', 'pachuli', 'benjui', 'caramelo', 'praline',
  'chocolate', 'cacao', 'miel', 'cuero', 'tabaco', 'ladano', 'incienso', 'olibano', 'mirra', 'balsamo', 'canela', 'azafran', 'cafe'];
const FIJADORES = [...PESADOS, 'almizcle', 'sandalo', 'cedro', 'vetiver', 'musgo', 'resina', 'madera', 'guayaco', 'cachemira', 'cashmeran',
  'cipriol', 'castana', 'cumarina', 'akigalawood', 'ebano', 'teca', 'gamuza'];
const NOCTURNOS = ['cuero', 'tabaco', 'oud', 'agar', 'incienso', 'mirra', 'ron', 'whisky', 'conac', 'absenta', 'chocolate', 'cacao', 'cafe', 'caramelo', 'praline'];
const POTENTES = ['oud', 'agar', 'ambroxan', 'ambarwood', 'amberwood', 'ambar gris'];

const FRESCOS = ['limon', 'lima', 'bergamota', 'pomelo', 'toronja', 'mandarina', 'naranja', 'yuzu', 'cidra', 'menta', 'marin', 'acuatic',
  'agua', 'calone', 'notas verdes', 'hierba', 'lavanda', 'romero', 'manzana', 'pera', 'pina', 'melon', 'sandia', 'pepino', 'jengibre',
  'te verde', 'verbena', 'neroli', 'petitgrain', 'enebro', 'cipres', 'salvia', 'albahaca', 'eucalipto', 'sal', 'ozono', 'hoja de violeta', 'bambu'];

// Balanza frescor/calidez: la primera familia del perfume pesa 2 puntos a su lado
function caracter(familias, todas, pesados) {
  const f = familias[0];
  const frescor = cuenta(todas, FRESCOS) + (['citrico', 'acuatico', 'fresco'].includes(f) ? 2 : 0);
  const calidez = pesados + (['oriental', 'gourmand'].includes(f) ? 2 : 0) + (familias.includes('dulce') ? 1 : 0);
  if (calidez - frescor >= 3) return 'calido';
  if (frescor - calidez >= 2) return 'fresco';
  if (['floral', 'frutal', 'dulce'].includes(f) && calidez <= 2) return 'ligero';
  return 'equilibrado';
}

function calcularUso(salida, corazon, fondo, familiasTexto) {
  const todas = [...salida, ...corazon, ...fondo];
  const familias = String(familiasTexto || '').split(',').filter(Boolean);
  const pes = cuenta(todas, PESADOS);
  const fij = cuenta(fondo, FIJADORES) + cuenta(corazon, FIJADORES) * 0.5;
  const noct = cuenta(todas, NOCTURNOS);
  const tipo = caracter(familias, todas, pes);

  // Duración (con ~33 % de esencia todos duran más que un eau de toilette)
  let duracion = fij >= 3 || pes >= 3 ? 'alta' : fij >= 1.5 ? 'media' : 'baja';
  if ((tipo === 'fresco' || tipo === 'ligero') && pes < 2 && duracion === 'alta') duracion = 'media';

  // Estela
  let estela = 'se_nota';
  if (pes >= 4 || (tipo === 'calido' && pes >= 3) || (cuenta(todas, POTENTES) >= 1 && pes >= 2)) estela = 'fuerte';
  else if ((tipo === 'fresco' || tipo === 'ligero') && pes === 0 && fij < 2) estela = 'suave';

  // Momento
  let momento;
  if (tipo === 'calido' || noct >= 2) momento = 'noche';
  else if (tipo === 'fresco' || tipo === 'ligero') momento = pes >= 2 || noct >= 1 ? 'ambos' : 'dia';
  else momento = 'ambos';

  // Temporada
  let temporadas;
  if (tipo === 'calido') temporadas = ['otono', 'invierno'];
  else if (tipo === 'fresco' || tipo === 'ligero') temporadas = pes >= 2 ? ['primavera', 'verano', 'otono'] : ['primavera', 'verano'];
  else temporadas = ['primavera', 'verano', 'otono', 'invierno'];

  return { momento, duracion, estela, temporadas, caracter: tipo };
}

module.exports = { calcularUso };
