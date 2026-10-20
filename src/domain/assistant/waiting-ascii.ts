// The waiting animations of the chat (ported 2026-10-20 from
// qvac_node/salud/app/public/espera-ascii.js, where they were chosen; the
// drawings are the same, only typed). Each one is a pure function
// `dibujar(cuadro, cols, filas)` → the whole frame as text. `cols` comes from
// the width on screen; `filas` is 9 for all, so switching never moves the
// layout. `cuadro` is the frame number, not a clock: the stopwatch beside it
// is the honest signal of how long it is taking.
//
// Two characters of the prototype arrived broken and were rebuilt by what
// they do: `│` joins two heights, `─` is the trace (the ECG of `latidos`).

export const FILAS = 9;

// --- herramientas de grilla --------------------------------------------------

function grilla(filas: number, cols: number, ch = " "): string[][] {
  const g: string[][] = [];
  for (let r = 0; r < filas; r++) g.push(new Array(cols).fill(ch));
  return g;
}

const texto = (g: string[][]): string =>
  g.map((fila) => fila.join("")).join("\n");

function ondaTriangular(x: number): number {
  const m = ((x % 1) + 1) % 1;
  return m < 0.5 ? m * 2 : (1 - m) * 2;
}

const modPos = (n: number, m: number): number => ((n % m) + m) % m;

// --- 01 bolas rebotando ------------------------------------------------------

const BOLAS = [
  { vy: 0.05, py: 0.0, vx: 0.021, px: 0.0, ch: "o" },
  { vy: 0.043, py: 1.7, vx: 0.017, px: 0.5, ch: "0" },
  { vy: 0.061, py: 0.9, vx: 0.026, px: 0.2, ch: "*" },
  { vy: 0.037, py: 2.6, vx: 0.014, px: 0.75, ch: "+" },
  { vy: 0.055, py: 3.4, vx: 0.023, px: 0.35, ch: "•" },
  { vy: 0.048, py: 4.1, vx: 0.019, px: 0.9, ch: "@" },
];

function bolas(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const piso = filas - 1;
  for (let c = 0; c < cols; c++) g[piso]![c] = "_";
  for (const b of BOLAS) {
    const alto = Math.abs(Math.sin(t * b.vy + b.py));
    const fila = piso - Math.round(alto * (piso - 1));
    const col = Math.round(ondaTriangular(t * b.vx + b.px) * (cols - 1));
    if (fila >= 0 && fila < filas && col >= 0 && col < cols)
      g[fila]![col] = b.ch;
  }
  return texto(g);
}

// --- 02 latidos --------------------------------------------------------------

const PULSO = [
  0, 0, 1, 1, 0, 0, 0, -1, 3, -2, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

function latidos(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const base = 4;
  for (let c = 0; c < cols; c++) g[base]![c] = "·";
  let anterior = base;
  for (let c = 0; c < cols; c++) {
    const dev = PULSO[(c + t) % PULSO.length]!;
    const fila = Math.min(filas - 1, Math.max(0, base - dev));
    const lo = Math.min(anterior, fila);
    const hi = Math.max(anterior, fila);
    for (let r = lo; r <= hi; r++) g[r]![c] = "│";
    g[fila]![c] = "─";
    anterior = fila;
  }
  return texto(g);
}

// --- 03 formas girando -------------------------------------------------------

const LADOS = 6;
const RADIO = 3.6;
// Una celda de texto es mucho más alta que ancha: sin esto el hexágono sale
// aplastado. Es la corrección de aspecto, no un ancho fijo.
const ASPECTO = 1.85;

function linea(
  g: string[][],
  p1: [number, number],
  p2: [number, number],
  ch: string,
  cols: number,
  filas: number,
): void {
  const pasos = 14;
  for (let s = 0; s <= pasos; s++) {
    const f = s / pasos;
    const fila = Math.round(p1[0] + (p2[0] - p1[0]) * f);
    const col = Math.round(p1[1] + (p2[1] - p1[1]) * f);
    if (fila >= 0 && fila < filas && col >= 0 && col < cols) g[fila]![col] = ch;
  }
}

function formas(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const cx = cols / 2;
  const cy = (filas - 1) / 2;
  const puntos: [number, number][] = [];
  for (let i = 0; i < LADOS; i++) {
    const a = t * 0.05 + i * ((2 * Math.PI) / LADOS);
    puntos.push([cy + Math.sin(a) * RADIO, cx + Math.cos(a) * RADIO * ASPECTO]);
  }
  for (let i = 0; i < LADOS; i++) {
    linea(g, puntos[i]!, puntos[(i + 1) % LADOS]!, "•", cols, filas);
  }
  return texto(g);
}

// --- 04 túnel ----------------------------------------------------------------

const TUNEL = [" ", ".", ":", "-", "=", "o", "O", "@"];

function tunel(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const cx = cols / 2;
  const cy = (filas - 1) / 2;
  for (let r = 0; r < filas; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = (c - cx) * 0.55;
      const dy = r - cy;
      const radio = Math.sqrt(dx * dx + dy * dy) + 0.0001;
      const anillo = 14 / radio - t * 0.12;
      g[r]![c] = TUNEL[modPos(Math.floor(anillo), TUNEL.length)]!;
    }
  }
  return texto(g);
}

// --- 05 caleidoscopio --------------------------------------------------------

const CUNAS = 8;
const KAL = [" ", ".", ":", "-", "+", "o", "O", "@"];

function caleidoscopio(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const cx = cols / 2;
  const cy = (filas - 1) / 2;
  const cuna = (2 * Math.PI) / CUNAS;
  for (let r = 0; r < filas; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = (c - cx) * 0.55;
      const dy = r - cy;
      const radio = Math.sqrt(dx * dx + dy * dy);
      const espejo = Math.abs(modPos(Math.atan2(dy, dx), cuna) - cuna / 2);
      const valor =
        Math.sin(radio * 0.9 - t * 0.08) + Math.cos(espejo * 6 + t * 0.05);
      const nivel = Math.round(((valor + 2) / 4) * (KAL.length - 1));
      g[r]![c] = KAL[Math.min(KAL.length - 1, Math.max(0, nivel))]!;
    }
  }
  return texto(g);
}

// --- 06 corredores -----------------------------------------------------------

const PERSONA = [
  [" ,o  ", " /|  ", " / \\ "],
  ["  o  ", " -|  ", " /|  "],
  [" `o  ", "  |\\ ", " / | "],
  ["  o  ", "  |- ", " |\\  "],
  [" ,o  ", "  |/ ", " | / "],
  ["  o  ", " \\|  ", " /\\  "],
];

const PERSONA2 = [
  [" .0  ", " /|  ", " / \\ "],
  ["  0  ", " -|  ", " /|  "],
  [" '0  ", "  |\\ ", " / | "],
  ["  0  ", "  |- ", " |\\  "],
  [" .0  ", "  |/ ", " | / "],
  ["  0  ", " \\|  ", " /\\  "],
];

const PERRO = [
  [" __  ", "/  o)", " ^ ^ "],
  [" __  ", "/  o)", "^ ^  "],
];

const PAJARO = [[" -^- "], [" -v- "]];

const CARRILES = [
  { cuadros: PERSONA, ancho: 5, arriba: 4, x0: 0, paso: 0.55, cada: 2 },
  { cuadros: PERSONA2, ancho: 5, arriba: 4, x0: 20, paso: 0.42, cada: 2 },
  { cuadros: PERSONA, ancho: 5, arriba: 4, x0: 34, paso: 0.63, cada: 2 },
  { cuadros: PERRO, ancho: 5, arriba: 5, x0: 10, paso: 0.7, cada: 3 },
  { cuadros: PAJARO, ancho: 5, arriba: 0, x0: 5, paso: 0.3, cada: 6 },
];

function estampar(
  g: string[][],
  cuadro: readonly string[],
  arriba: number,
  izquierda: number,
  cols: number,
  filas: number,
): void {
  for (let r = 0; r < cuadro.length; r++) {
    const linea = cuadro[r]!;
    for (let i = 0; i < linea.length; i++) {
      const fila = arriba + r;
      const col = izquierda + i;
      if (
        fila >= 0 &&
        fila < filas &&
        col >= 0 &&
        col < cols &&
        linea[i] !== " "
      ) {
        g[fila]![col] = linea[i]!;
      }
    }
  }
}

function corredores(t: number, cols: number, filas: number): string {
  const g = grilla(filas, cols);
  const suelo = filas - 1;
  for (let c = 0; c < cols; c++) g[suelo]![c] = "_";
  for (const ent of CARRILES) {
    // Sin mutar: la misma posición a la que llegaba el prototipo acumulando.
    const x = modPos(ent.x0 + ent.paso * t, cols + ent.ancho);
    const cuadro = ent.cuadros[Math.floor(t / ent.cada) % ent.cuadros.length]!;
    estampar(g, cuadro, ent.arriba, Math.floor(x) - ent.ancho, cols, filas);
  }
  return texto(g);
}

// --- las seis ----------------------------------------------------------------

export interface WaitingAnimation {
  readonly id: string;
  readonly nombre: string;
  readonly dibujar: (cuadro: number, cols: number, filas: number) => string;
}

export const VARIANTES: readonly WaitingAnimation[] = [
  { id: "bolas", nombre: "Bolas rebotando", dibujar: bolas },
  { id: "latidos", nombre: "Latidos", dibujar: latidos },
  { id: "formas", nombre: "Formas girando", dibujar: formas },
  { id: "tunel", nombre: "Túnel", dibujar: tunel },
  { id: "caleidoscopio", nombre: "Caleidoscopio", dibujar: caleidoscopio },
  { id: "corredores", nombre: "Corredores", dibujar: corredores },
];
