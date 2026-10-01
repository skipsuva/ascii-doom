// Level loading, geometry queries, collision and map progression.
import type { Geo, Level } from '../types';
import { GeoImpl } from './collision';

export { loadLevel } from './level';
export { mapList, nextMap } from './maps';

export function createGeo(level: Level): Geo {
  return new GeoImpl(level);
}
