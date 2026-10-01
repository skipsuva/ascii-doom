// Builds the runtime Level (linked sectors/lines/sides/segs/subsectors/nodes) from raw map lumps.
import { NF_SUBSECTOR, type BspNode, type Level, type Line, type Sector, type Seg, type Side, type Subsector, type ThingSpawn, type Vertex } from '../types';
import type { Wads } from '../wad/wad';
import { bam16ToRad } from '../math';
import { parseLinedefs, parseNodes, parseSectors, parseSegs, parseSidedefs, parseSubsectors, parseThings, parseVertexes } from './map';
import { parseOrBuildBlockmap } from './blockmap';
import { pointOnLineSide, pointOnNodeSide } from './common';

export function loadLevel(wads: Wads, name: string): Level {
  const mapName = name.toUpperCase();
  const lumps = wads.mapLumps(mapName);
  if (!lumps) throw new Error(`Map ${mapName} not found in loaded WADs`);
  const need = (n: string) => {
    const l = lumps.get(n);
    if (!l) throw new Error(`Map ${mapName}: missing ${n} lump`);
    return l;
  };

  const rawThings = parseThings(need('THINGS'));
  const rawLinedefs = parseLinedefs(need('LINEDEFS'));
  const rawSidedefs = parseSidedefs(need('SIDEDEFS'));
  const rawVertexes = parseVertexes(need('VERTEXES'));
  const rawSegs = parseSegs(need('SEGS'));
  const rawSubsectors = parseSubsectors(need('SSECTORS'));
  const rawNodes = parseNodes(need('NODES'));
  const rawSectors = parseSectors(need('SECTORS'));

  const vertices: Vertex[] = rawVertexes.map(v => ({ x: v.x, y: v.y }));
  if (vertices.length === 0) throw new Error(`Map ${mapName}: no vertices`);
  if (rawSectors.length === 0) throw new Error(`Map ${mapName}: no sectors`);

  const sectors: Sector[] = rawSectors.map((r, i) => ({
    id: i, floorH: r.floorH, ceilH: r.ceilH, floorFlat: r.floorFlat, ceilFlat: r.ceilFlat,
    light: r.light, special: r.special, tag: r.tag,
    lines: [], neighbors: [], things: new Set(), specialData: null, lightData: null, soundTarget: null, validcount: 0,
  }));

  const sides: Side[] = rawSidedefs.map((r, i) => ({
    id: i, xoff: r.xoff, yoff: r.yoff, top: r.top || '-', bottom: r.bottom || '-', mid: r.mid || '-',
    sector: sectors[r.sector] ?? sectors[0],
  }));

  const bounds = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  const neighborSets = sectors.map(() => new Set<Sector>());
  const lines: Line[] = new Array(rawLinedefs.length);
  for (let i = 0; i < rawLinedefs.length; i++) {
    const r = rawLinedefs[i];
    const v1 = vertices[r.v1] ?? vertices[0];
    const v2 = vertices[r.v2] ?? vertices[0];
    let front: Side | null = r.right >= 0 && r.right < sides.length ? sides[r.right] : null;
    let back: Side | null = r.left >= 0 && r.left < sides.length ? sides[r.left] : null;
    if (!front) {
      if (back) { front = back; back = null; }
      else {
        front = { id: sides.length, xoff: 0, yoff: 0, top: '-', bottom: '-', mid: '-', sector: sectors[0] };
        sides.push(front);
      }
    }
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const slopeType = dx === 0 ? 1 : dy === 0 ? 0 : dy / dx > 0 ? 2 : 3;
    const line: Line = {
      id: i, v1, v2, dx, dy, flags: r.flags, special: r.special, tag: r.tag,
      front, back, frontSector: front.sector, backSector: back ? back.sector : null,
      bbox: [Math.min(v1.x, v2.x), Math.min(v1.y, v2.y), Math.max(v1.x, v2.x), Math.max(v1.y, v2.y)],
      slopeType, mapped: false, validcount: 0,
    };
    lines[i] = line;
    line.frontSector.lines.push(line);
    if (line.backSector && line.backSector !== line.frontSector) {
      line.backSector.lines.push(line);
      neighborSets[line.frontSector.id].add(line.backSector);
      neighborSets[line.backSector.id].add(line.frontSector);
    }
    if (line.bbox[0] < bounds.minx) bounds.minx = line.bbox[0];
    if (line.bbox[1] < bounds.miny) bounds.miny = line.bbox[1];
    if (line.bbox[2] > bounds.maxx) bounds.maxx = line.bbox[2];
    if (line.bbox[3] > bounds.maxy) bounds.maxy = line.bbox[3];
  }
  if (!Number.isFinite(bounds.minx)) {
    for (const v of vertices) {
      if (v.x < bounds.minx) bounds.minx = v.x;
      if (v.y < bounds.miny) bounds.miny = v.y;
      if (v.x > bounds.maxx) bounds.maxx = v.x;
      if (v.y > bounds.maxy) bounds.maxy = v.y;
    }
  }
  for (let i = 0; i < sectors.length; i++) sectors[i].neighbors = [...neighborSets[i]];

  const segs: Seg[] = new Array(rawSegs.length);
  for (let i = 0; i < rawSegs.length; i++) {
    const r = rawSegs[i];
    const line = lines[r.linedef] ?? lines[0];
    const side = (r.side & 1) as 0 | 1;
    const v1 = vertices[r.v1] ?? vertices[0];
    const v2 = vertices[r.v2] ?? vertices[0];
    let frontSector: Sector;
    let backSector: Sector | null;
    if (side === 1 && line.back) {
      frontSector = line.back.sector;
      backSector = line.frontSector;
    } else {
      frontSector = line.frontSector;
      backSector = side === 0 ? line.backSector : null;
    }
    segs[i] = {
      id: i, v1, v2, angle: bam16ToRad(r.angle), line, side, offset: r.offset,
      frontSector, backSector, length: Math.hypot(v2.x - v1.x, v2.y - v1.y),
    };
  }

  const subsectors: Subsector[] = rawSubsectors.map((r, i) => {
    const ss = segs.slice(r.firstSeg, r.firstSeg + r.numSegs);
    return { id: i, sector: ss[0]?.frontSector ?? sectors[0], segs: ss };
  });
  if (subsectors.length === 0) throw new Error(`Map ${mapName}: no subsectors (map has no BSP data)`);

  const nodes: BspNode[] = rawNodes.map(r => ({
    x: r.x, y: r.y, dx: r.dx, dy: r.dy,
    bbox: [r.bboxRight, r.bboxLeft],
    children: [r.childRight, r.childLeft],
  }));

  const blockmap = parseOrBuildBlockmap(lumps.get('BLOCKMAP'), lines, bounds);
  const things: ThingSpawn[] = rawThings.map(t => ({ x: t.x, y: t.y, angle: t.angle, type: t.type, flags: t.flags }));

  const pointInSubsector = (x: number, y: number): Subsector => {
    if (nodes.length === 0) return subsectors[0];
    let num = nodes.length - 1;
    let guard = 0;
    while (!(num & NF_SUBSECTOR)) {
      const node = nodes[num];
      if (!node) return subsectors[0];
      num = node.children[pointOnNodeSide(x, y, node)];
      if (++guard > 100000) return subsectors[0];
    }
    return subsectors[num & 0x7fff] ?? subsectors[0];
  };

  return {
    name: mapName, vertices, sectors, sides, lines, segs, subsectors, nodes, blockmap, things, bounds,
    pointInSubsector,
    pointInSector: (x, y) => pointInSubsector(x, y).sector,
    pointOnLineSide,
    pointOnNodeSide,
  };
}
