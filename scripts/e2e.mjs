// End-to-end check: builds nothing, just serves the already-built game (dist/) in a real
// headless browser, plays it with simulated key presses and touches, and saves screenshots
// to test-output/. Run with:  npm run build && npm run test:e2e
//
// Uses the Playwright + Chromium that is pre-installed in the Claude Code cloud environment.
// (It is not run on Netlify; Netlify runs the faster `npm test` unit tests.)
import { preview } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const server = await preview({ preview: { port: 4173, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

try {
  // ---------------- Desktop ----------------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(url);
  await page.waitForFunction(() => window.__epipalace);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/01-start-screen.png` });
  check(await page.isVisible('.overlay'), 'start screen is shown');

  await page.goto(url + '?autotest');
  await page.waitForFunction(() => window.__epipalace?.active);
  await page.waitForTimeout(800);
  const P = () => page.evaluate(() => {
    const { player, state } = window.__epipalace.game;
    return { x: player.x, y: player.y, z: player.z, yaw: player.yaw, room: state.room?.id, respawns: state.respawns };
  });
  const place = (x, z, yaw) => page.evaluate(([x, z, yaw]) => window.__epipalace.game.placeAt({ x, y: window.__epipalace.level.groundAt(x, z), z, yaw }), [x, z, yaw]);
  const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(100); };

  let p = await P();
  const spawnY = await page.evaluate(() => window.__epipalace.level.spawn.y);
  check(p.room === 1 && Math.abs(p.y - spawnY) < 1e-6, `player starts standing in Room 1 (room ${p.room}, y ${p.y.toFixed(3)})`);
  await page.screenshot({ path: `${OUT}/02-entrance.png` });

  // Walk east into Room 1's east wall (x = 6) for 3 seconds: must stop at the wall.
  await place(3, 25, -Math.PI / 2);
  await hold('KeyW', 3000);
  p = await P();
  check(p.x < 6 - 0.15 - 0.3 + 0.001 && p.x > 5, `holding W into a wall stops at the wall (x = ${p.x.toFixed(3)}, wall face at 5.85)`);
  await page.screenshot({ path: `${OUT}/03-against-wall.png` });

  // Strafe (D) and back (S) also blocked
  await place(0, 27, 0);
  await hold('KeyS', 2500);
  p = await P();
  check(p.z < 30 - 0.45 + 0.001, `walking backwards into the south wall is blocked (z = ${p.z.toFixed(3)})`);

  // Walk north through the door into Room 2
  await place(0, 23, 0);
  await hold('KeyW', 1500);
  p = await P();
  check(p.room === 2, `walking north through the door reaches Room 2 (now in room ${p.room})`);
  const hudText = await page.textContent('.hud-room');
  check(hudText.includes('Room 2'), `HUD shows the current room ("${hudText}")`);
  await page.screenshot({ path: `${OUT}/04-central-hall.png` });

  // Ramp: from the Entrance up into the Central Hall
  await place(0, 27, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04b-ramp.png` });
  await hold('KeyW', 2500);
  p = await P();
  check(p.room === 2 && Math.abs(p.y) < 0.01, `walking up the ramp reaches Room 2 at floor 0 (room ${p.room}, y ${p.y.toFixed(2)})`);

  // Stairs: from the Right Wing up into the Upper Gallery
  await place(17, 13, -Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04c-stairs.png` });
  await hold('KeyW', 3000);
  p = await P();
  check(p.room === 9 && Math.abs(p.y - 1.8) < 0.01, `walking up the stairs reaches Room 9 at 1.8 m (room ${p.room}, y ${p.y.toFixed(2)})`);

  // Look at the curved wall and the pillars
  await place(-5, -12, Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04d-curved-wall.png` });
  await place(-9.5, 13, Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04e-pillars.png` });

  // Jump
  await place(0, 13, 0);
  await page.waitForTimeout(200);
  await page.keyboard.down('Space');
  let peak = 0;
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(30); peak = Math.max(peak, (await P()).y); }
  await page.keyboard.up('Space');
  check(peak > 0.5, `Space makes the player jump (peak ${peak.toFixed(2)} m)`);

  // Mouse look via drag fallback (pointer lock is not available in headless test)
  const yaw0 = (await P()).yaw;
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  check((await P()).yaw < yaw0 - 0.1, 'moving the mouse right turns the view right');

  // Chasm in Room 8: walk off the edge
  await place(6, -12, -Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-chasm.png` });
  await hold('KeyW', 2500);
  p = await P();
  check(p.respawns >= 1 && p.room === 8 && Math.abs(p.y) < 0.01, `falling into the chasm respawns at the top (respawns ${p.respawns}, room ${p.room})`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/06-after-respawn.png` });

  // Look at a few rooms for brightness
  const rooms = await page.evaluate(() => window.__epipalace.level.rooms.map((r) => ({ id: r.id, x: r.x + r.w / 2, z: r.z + r.d - 1 })));
  for (const r of rooms) {
    await place(r.x, r.z, 0);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/room-${r.id}.png` });
  }
  // Average brightness of a room screenshot, measured in the page.
  // Average brightness of a real screenshot of a room.
  const shot = (await page.screenshot()).toString('base64');
  const brightness = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const k = document.createElement('canvas');
    k.width = 64; k.height = 40;
    const g = k.getContext('2d');
    g.drawImage(img, 0, 0, 64, 40);
    const d = g.getImageData(0, 0, 64, 40).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, shot);
  check(brightness > 120, `rooms are bright (average brightness ${brightness.toFixed(0)} of 255)`);

  // Debug map
  await place(0, 27, 0);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/07-map-corner.png` });
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.__epipalace.map.mode)) === 'full', 'M cycles the debug map to full screen');
  await page.screenshot({ path: `${OUT}/08-map-full.png` });
  await page.keyboard.press('KeyM');

  check(errors.length === 0, `no errors in the browser console${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();

  // ---------------- Phone ----------------
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await ctx.newPage();
  const perrors = [];
  phone.on('pageerror', (e) => perrors.push(e.message));
  await phone.goto(url);
  await phone.waitForFunction(() => window.__epipalace);
  await phone.waitForTimeout(400);
  check(await phone.isVisible('.btn-jump'), 'phone: touch controls are shown');
  await phone.screenshot({ path: `${OUT}/10-phone-start.png` });
  await phone.tap('.overlay');
  await phone.waitForTimeout(300);
  check(await phone.evaluate(() => window.__epipalace.active), 'phone: tapping starts the game');

  // Simulate a thumb on the joystick (left half), pushing up = forward.
  const vp = phone.viewportSize();
  const z0 = await phone.evaluate(() => window.__epipalace.game.player.z);
  await phone.evaluate(([w, h]) => {
    const zone = document.querySelector('.zone-move');
    const ev = (type, x, y) => new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true });
    zone.dispatchEvent(ev('pointerdown', w * 0.25, h * 0.75));
    zone.dispatchEvent(ev('pointermove', w * 0.25, h * 0.75 - 50));
  }, [vp.width, vp.height]);
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: `${OUT}/11-phone-joystick.png` });
  await phone.evaluate(() => document.querySelector('.zone-move').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true, pointerType: 'touch' })));
  const z1 = await phone.evaluate(() => window.__epipalace.game.player.z);
  check(z1 < z0 - 1, `phone: joystick moves the player forward (z ${z0.toFixed(2)} -> ${z1.toFixed(2)})`);

  // Look pad: drag on the right half
  const y0 = await phone.evaluate(() => window.__epipalace.game.player.yaw);
  await phone.evaluate(([w, h]) => {
    const zone = document.querySelector('.zone-look');
    const ev = (type, x, y) => new PointerEvent(type, { pointerId: 8, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' });
    zone.dispatchEvent(ev('pointerdown', w * 0.75, h * 0.5));
    zone.dispatchEvent(ev('pointermove', w * 0.75 - 60, h * 0.5));
    zone.dispatchEvent(ev('pointerup', w * 0.75 - 60, h * 0.5));
  }, [vp.width, vp.height]);
  await phone.waitForTimeout(200);
  const y1 = await phone.evaluate(() => window.__epipalace.game.player.yaw);
  check(y1 > y0 + 0.1, 'phone: dragging left on the look pad turns the view left');

  // Jump button
  await phone.evaluate(() => window.__epipalace.game.placeAt({ x: 0, y: 0, z: 13, yaw: 0 }));
  await phone.waitForTimeout(200);
  await phone.evaluate(() => document.querySelector('.btn-jump').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
  let ppeak = 0;
  for (let i = 0; i < 10; i++) { await phone.waitForTimeout(30); ppeak = Math.max(ppeak, await phone.evaluate(() => window.__epipalace.game.player.y)); }
  await phone.evaluate(() => document.querySelector('.btn-jump').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
  check(ppeak > 0.5, `phone: Jump button jumps (peak ${ppeak.toFixed(2)} m)`);

  await phone.tap('.btn-map');
  await phone.tap('.btn-map');
  await phone.waitForTimeout(200);
  check((await phone.evaluate(() => window.__epipalace.map.mode)) === 'full', 'phone: Map button opens the map');
  await phone.screenshot({ path: `${OUT}/12-phone-map.png` });
  check(perrors.length === 0, `phone: no page errors${perrors.length ? ': ' + perrors.join(' | ') : ''}`);
  await ctx.close();
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll browser checks passed.');
process.exit(failures.length ? 1 : 0);
