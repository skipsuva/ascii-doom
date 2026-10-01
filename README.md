# ASCII DOOM

<img width="2326" height="1433" alt="image (156)" src="https://github.com/user-attachments/assets/4e8f0e26-bff3-41f2-89ad-d8f81b135c9e" />


A browser DOOM engine that renders the game as ASCII art and loads the **original DOOM WAD files**.

- Real BSP software renderer (walls, floors, ceilings, sky, sprites, light diminishing) drawn into a glyph grid.
- Loads IWADs/PWADs: the shareware `doom1.wad` is downloaded automatically; drop any other `.wad` onto the page.
- Monsters with DOOM's chase/attack AI, hitscan & fireball attacks, pain/death states.
- Fist, pistol, shotgun, chaingun (+ rocket launcher), ammo/health/armor/key pickups.
- Doors, lifts, moving floors/ceilings, switches, keycards, teleporters, exits → next level, intermission screens.
- Sound effects decoded from the WAD's DMX lumps via WebAudio.

## Run

```bash
npm install
npm run dev        # downloads public/wads/doom1.wad on first run, then serves http://localhost:5173
```

## Controls

| Key | Action |
| --- | --- |
| W / S, Arrow Up / Down | Move |
| A / D | Strafe |
| Arrow Left / Right, mouse | Turn |
| Shift | Run |
| Ctrl, mouse button | Fire |
| Space / E | Use (doors, switches) |
| 1–5 | Weapons |
| Tab | Automap (+ / - zoom) |
| C | Toggle colored glyphs |
| M | Mute |
| Enter | Start / continue |

## Developer tools

```bash
npm test                       # WAD / level / world unit tests (vitest)
npm run frame -- E1M1          # print one ASCII frame of a map to the terminal (--pos x,y,deg --things)
npm run shoot                  # Playwright: drive the running dev server, save shots/*.png + ASCII dumps
npm run verify                 # Playwright: scripted gameplay checks (pickups, doors, lifts, monsters, exit, death)
npm run build                  # type-check + production bundle in dist/
```

URL parameters for testing: `?map=E1M2&autostart=1&nosound=1&pos=x,y,deg&god=1&noclip=1&wad=URL&font=12`.
# ascii-doom
