// Vanilla animated flat/texture groups (p_spec.c animdefs) and switch texture pairing.

const FLAT_GROUPS: string[][] = [
  ['NUKAGE1', 'NUKAGE2', 'NUKAGE3'],
  ['FWATER1', 'FWATER2', 'FWATER3', 'FWATER4'],
  ['SWATER1', 'SWATER2', 'SWATER3', 'SWATER4'],
  ['LAVA1', 'LAVA2', 'LAVA3', 'LAVA4'],
  ['BLOOD1', 'BLOOD2', 'BLOOD3'],
  ['RROCK05', 'RROCK06', 'RROCK07', 'RROCK08'],
  ['SLIME01', 'SLIME02', 'SLIME03', 'SLIME04'],
  ['SLIME05', 'SLIME06', 'SLIME07', 'SLIME08'],
  ['SLIME09', 'SLIME10', 'SLIME11', 'SLIME12'],
];

const TEXTURE_GROUPS: string[][] = [
  ['BLODGR1', 'BLODGR2', 'BLODGR3', 'BLODGR4'],
  ['SLADRIP1', 'SLADRIP2', 'SLADRIP3'],
  ['BLODRIP1', 'BLODRIP2', 'BLODRIP3', 'BLODRIP4'],
  ['FIREWALA', 'FIREWALB', 'FIREWALL'],
  ['GSTFONT1', 'GSTFONT2', 'GSTFONT3'],
  ['FIRELAV3', 'FIRELAVA'],
  ['FIREMAG1', 'FIREMAG2', 'FIREMAG3'],
  ['FIREBLU1', 'FIREBLU2'],
  ['ROCKRED1', 'ROCKRED2', 'ROCKRED3'],
  ['BFALL1', 'BFALL2', 'BFALL3', 'BFALL4'],
  ['SFALL1', 'SFALL2', 'SFALL3', 'SFALL4'],
  ['WFALL1', 'WFALL2', 'WFALL3', 'WFALL4'],
  ['DBRAIN1', 'DBRAIN2', 'DBRAIN3', 'DBRAIN4'],
];

export function buildAnims(hasTexture: (n: string) => boolean, hasFlat: (n: string) => boolean): { flats: string[][]; textures: string[][] } {
  return {
    flats: FLAT_GROUPS.filter(g => g.every(hasFlat)).map(g => [...g]),
    textures: TEXTURE_GROUPS.filter(g => g.every(hasTexture)).map(g => [...g]),
  };
}

/** SW1xxx <-> SW2xxx when the counterpart texture exists. */
export function switchPair(name: string, hasTexture: (n: string) => boolean): string | null {
  const n = name.toUpperCase();
  let other: string | null = null;
  if (n.startsWith('SW1')) other = 'SW2' + n.slice(3);
  else if (n.startsWith('SW2')) other = 'SW1' + n.slice(3);
  if (!other || !hasTexture(other)) return null;
  return other;
}
