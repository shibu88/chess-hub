// Unicode chess glyphs + accessible labels. No image assets, no licence concern.

// Solid (filled) glyph shapes are used for BOTH colours; colour is applied in
// CSS (white fill vs dark fill, each outlined) so pieces stay legible on light
// and dark squares. The hollow white glyphs (♔) disappear on dark squares.
const SHAPE = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

const NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

export function glyph(_color, type) {
  return SHAPE[type] ?? '';
}

export function pieceLabel(color, type) {
  return `${color === 'w' ? 'White' : 'Black'} ${NAME[type]}`;
}

export function pieceName(type) {
  return NAME[type];
}
