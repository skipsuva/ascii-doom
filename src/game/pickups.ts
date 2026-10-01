// Item pickup effects (P_TouchSpecialThing). Items are identified by info.pickup (string) set by the world's info table.
import { AMMO, MF, WEAPON, type GameCtx, type Mobj, type Player } from '../types';

/** ammo per "clip" pickup: bullets, shells, rockets, cells */
const CLIP_AMMO = [10, 4, 1, 20];
const MAX_AMMO = [200, 50, 50, 300];

function giveAmmo(p: Player, type: number, count: number): boolean {
  if (type === AMMO.NONE || type < 0 || type > 3) return false;
  if (p.ammo[type] >= p.maxAmmo[type]) return false;
  const old = p.ammo[type];
  p.ammo[type] = Math.min(p.maxAmmo[type], p.ammo[type] + count);
  // DOOM: switching from fist/pistol to a better weapon when we were out of ammo
  if (old === 0 && p.pendingWeapon < 0) {
    if (p.readyWeapon === WEAPON.FIST) {
      if (type === AMMO.BULLETS && p.weapons[WEAPON.CHAINGUN]) p.pendingWeapon = WEAPON.CHAINGUN;
      else if (type === AMMO.BULLETS && p.weapons[WEAPON.PISTOL]) p.pendingWeapon = WEAPON.PISTOL;
      else if (type === AMMO.SHELLS && p.weapons[WEAPON.SHOTGUN]) p.pendingWeapon = WEAPON.SHOTGUN;
    }
  }
  return true;
}

function giveWeapon(p: Player, weapon: number, ammoType: number, dropped: boolean): boolean {
  let gaveAmmo = false;
  if (ammoType !== AMMO.NONE) {
    gaveAmmo = giveAmmo(p, ammoType, dropped ? CLIP_AMMO[ammoType] : CLIP_AMMO[ammoType] * 2);
  }
  let gaveWeapon = false;
  if (!p.weapons[weapon]) {
    p.weapons[weapon] = true;
    p.pendingWeapon = weapon;
    gaveWeapon = true;
  }
  return gaveWeapon || gaveAmmo;
}

function giveBody(p: Player, num: number): boolean {
  if (p.health >= 100) return false;
  p.health = Math.min(100, p.health + num);
  p.mo.health = p.health;
  return true;
}

function giveArmor(p: Player, type: number): boolean {
  const hits = type * 100;
  if (p.armor >= hits) return false;
  p.armorType = type;
  p.armor = hits;
  return true;
}

export function playerMaxAmmo(backpack: boolean): number[] {
  return MAX_AMMO.map(v => (backpack ? v * 2 : v));
}

/** Returns true if the item was picked up (and removed). */
export function touchSpecial(ctx: GameCtx, item: Mobj, toucher: Mobj): boolean {
  const p = toucher.player;
  if (!p || p.dead || item.removed) return false;
  const delta = item.z - toucher.z;
  if (delta > toucher.height || delta < -8) return false; // out of reach vertically
  const kind = typeof item.info.pickup === 'string' ? (item.info.pickup as string) : null;
  if (!kind) return false;
  const dropped = (item.flags & MF.DROPPED) !== 0;
  let sound = 'DSITEMUP';
  let msg = '';
  let ok = true;
  const half = (n: number) => (dropped ? Math.max(1, n >> 1) : n);
  switch (kind) {
    case 'armorbonus':
      p.armor = Math.min(200, p.armor + 1);
      if (p.armorType === 0) p.armorType = 1;
      msg = 'Picked up an armor bonus.';
      break;
    case 'healthbonus':
      p.health = Math.min(200, p.health + 1);
      p.mo.health = p.health;
      msg = 'Picked up a health bonus.';
      break;
    case 'stimpack':
      ok = giveBody(p, 10);
      msg = 'Picked up a stimpack.';
      break;
    case 'medikit':
      msg = p.health < 25 ? 'Picked up a medikit that you REALLY need!' : 'Picked up a medikit.';
      ok = giveBody(p, 25);
      break;
    case 'soulsphere':
      p.health = Math.min(200, p.health + 100);
      p.mo.health = p.health;
      msg = 'Supercharge!';
      sound = 'DSGETPOW';
      break;
    case 'megasphere':
      p.health = 200; p.mo.health = 200;
      giveArmor(p, 2);
      msg = 'MegaSphere!';
      sound = 'DSGETPOW';
      break;
    case 'greenarmor':
      ok = giveArmor(p, 1);
      msg = 'Picked up the armor.';
      break;
    case 'bluearmor':
      ok = giveArmor(p, 2);
      msg = 'Picked up the MegaArmor!';
      break;
    case 'clip':
      ok = giveAmmo(p, AMMO.BULLETS, half(CLIP_AMMO[AMMO.BULLETS]));
      msg = 'Picked up a clip.';
      break;
    case 'clipbox':
      ok = giveAmmo(p, AMMO.BULLETS, 50);
      msg = 'Picked up a box of bullets.';
      break;
    case 'shells':
      ok = giveAmmo(p, AMMO.SHELLS, half(CLIP_AMMO[AMMO.SHELLS]));
      msg = 'Picked up 4 shotgun shells.';
      break;
    case 'shellbox':
      ok = giveAmmo(p, AMMO.SHELLS, 20);
      msg = 'Picked up a box of shotgun shells.';
      break;
    case 'rocket':
      ok = giveAmmo(p, AMMO.ROCKETS, 1);
      msg = 'Picked up a rocket.';
      break;
    case 'rocketbox':
      ok = giveAmmo(p, AMMO.ROCKETS, 5);
      msg = 'Picked up a box of rockets.';
      break;
    case 'cell':
      ok = giveAmmo(p, AMMO.CELLS, half(CLIP_AMMO[AMMO.CELLS]));
      msg = 'Picked up an energy cell.';
      break;
    case 'cellpack':
      ok = giveAmmo(p, AMMO.CELLS, 100);
      msg = 'Picked up an energy cell pack.';
      break;
    case 'backpack':
      if (!p.backpack) {
        p.backpack = true;
        p.maxAmmo = playerMaxAmmo(true);
      }
      for (let i = 0; i < 4; i++) giveAmmo(p, i, CLIP_AMMO[i]);
      msg = 'Picked up a backpack full of ammo!';
      break;
    case 'shotgun':
      ok = giveWeapon(p, WEAPON.SHOTGUN, AMMO.SHELLS, dropped);
      msg = 'You got the shotgun!';
      sound = 'DSWPNUP';
      break;
    case 'chaingun':
      ok = giveWeapon(p, WEAPON.CHAINGUN, AMMO.BULLETS, dropped);
      msg = 'You got the chaingun!';
      sound = 'DSWPNUP';
      break;
    case 'rocketlauncher':
      ok = giveWeapon(p, WEAPON.ROCKET, AMMO.ROCKETS, dropped);
      msg = 'You got the rocket launcher!';
      sound = 'DSWPNUP';
      break;
    case 'plasma':
      ok = giveWeapon(p, WEAPON.PLASMA, AMMO.CELLS, dropped);
      msg = 'You got the plasma gun!';
      sound = 'DSWPNUP';
      break;
    case 'bfg':
      ok = giveWeapon(p, WEAPON.BFG, AMMO.CELLS, dropped);
      msg = 'You got the BFG9000!  Oh, yes.';
      sound = 'DSWPNUP';
      break;
    case 'chainsaw':
      ok = giveWeapon(p, WEAPON.CHAINSAW, AMMO.NONE, dropped);
      msg = 'A chainsaw!  Find some meat!';
      sound = 'DSWPNUP';
      break;
    case 'bluecard': msg = 'Picked up a blue keycard.'; p.keys.blue = true; break;
    case 'yellowcard': msg = 'Picked up a yellow keycard.'; p.keys.yellow = true; break;
    case 'redcard': msg = 'Picked up a red keycard.'; p.keys.red = true; break;
    case 'blueskull': msg = 'Picked up a blue skull key.'; p.keys.blue = true; break;
    case 'yellowskull': msg = 'Picked up a yellow skull key.'; p.keys.yellow = true; break;
    case 'redskull': msg = 'Picked up a red skull key.'; p.keys.red = true; break;
    case 'berserk':
      p.berserk = 35 * 60;
      giveBody(p, 100);
      if (p.readyWeapon !== WEAPON.FIST) p.pendingWeapon = WEAPON.FIST;
      msg = 'Berserk!';
      sound = 'DSGETPOW';
      break;
    case 'invuln': msg = 'Invulnerability!'; sound = 'DSGETPOW'; break;
    case 'invis': msg = 'Partial Invisibility'; sound = 'DSGETPOW'; break;
    case 'radsuit': msg = 'Radiation Shielding Suit'; sound = 'DSGETPOW'; break;
    case 'map': msg = 'Computer Area Map'; sound = 'DSGETPOW'; break;
    case 'lightamp': msg = 'Light Amplification Visor'; sound = 'DSGETPOW'; break;
    default:
      return false;
  }
  if (!ok) return false;
  if (item.flags & MF.COUNTITEM) p.itemcount++;
  ctx.remove(item);
  ctx.flash('bonus', 6);
  if (msg) ctx.message(msg);
  ctx.playSound(sound);
  return true;
}
