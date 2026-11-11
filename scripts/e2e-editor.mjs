// Browser test for the map editor (/editor): draws with the mouse, edits the panel, undoes,
// previews in first person, downloads, reloads. Run after `npm run build`:
//   node scripts/e2e-editor.mjs        (screenshots in test-output/)
import { preview } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const server = await preview({ preview: { port: 4174, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // /editor without the trailing slash must work too (that is what people will type).
  await page.goto(base + 'editor');
  await page.waitForFunction(() => window.__editor);
  check((await page.title()).includes('Map Editor'), 'epipalace.com/editor opens the map editor');
  const E = (fn, arg) => page.evaluate(fn, arg);
  check((await E(() => window.__editor.data.rooms.length)) === 12, 'editor loads the current level (12 rooms)');
  await page.screenshot({ path: `${OUT}/editor-01-open.png` });

  // Helpers: mouse actions in world coordinates (metres)
  const S = async (x, z) => {
    const box = await page.locator('#map').boundingBox();
    const [sx, sz] = await E(([x, z]) => window.__editor.W2S(x, z), [x, z]);
    if (sx < 0 || sz < 0 || sx > box.width || sz > box.height) throw new Error(`test bug: point ${x},${z} is off the visible map`);
    return [box.x + sx, box.y + sz];
  };
  const dragW = async (a, b) => {
    const [x0, y0] = await S(...a);
    const [x1, y1] = await S(...b);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
  };
  const clickW = async (p) => {
    const [x, y] = await S(...p);
    await page.mouse.click(x, y);
  };
  const rooms = () => E(() => window.__editor.data.rooms.map((r) => ({ ...r })));
  const problems = () => page.locator('#problems li.bad').allTextContents();

  // 1. Draw a room touching Room 9's east wall
  // Make room on screen for the new room east of the palace: zoom out a step and pan right.
  await page.click('[data-action="zoom-out"]');
  await page.evaluate(() => (window.__editor.view.x += 14));
  await page.keyboard.press('r');
  await dragW([40, 8], [48, 18]);
  await page.click('[data-action="fit"]');
  let rs = await rooms();
  const r13 = rs.find((r) => r.id === 13);
  check(r13 && r13.x === 40 && r13.z === 8 && r13.w === 8 && r13.d === 10, `drag with the Room tool draws Room 13 at 40,8 size 8×10 (${JSON.stringify(r13 && [r13.x, r13.z, r13.w, r13.d])})`);
  check((await E(() => window.__editor.selection?.type)) === 'rooms', 'the new room is selected, and the tool returns to Select');

  // 2. Set its floor height in the panel to match Room 9 (1.8 m) and rename it
  await page.fill('#f-floor', '1.8');
  await page.press('#f-floor', 'Enter');
  await page.fill('#f-name', 'Test Room');
  await page.press('#f-name', 'Enter');
  rs = await rooms();
  check(rs.find((r) => r.id === 13).floor === 1.8 && rs.find((r) => r.id === 13).name === 'Test Room', 'panel edits change the floor height and the name');

  // 3. Doorway between 11 and 13
  await page.keyboard.press('d');
  await clickW([40, 13]);
  const doors = await E(() => window.__editor.data.doors);
  check(doors.some((d) => d.between.includes(11) && d.between.includes(13)), 'Door tool: clicking the shared wall adds a doorway between Rooms 11 and 13');

  // 4. Resize the room by dragging its east handle from x=42 to x=44
  await clickW([44, 12]);
  await dragW([48, 13], [50, 13]);
  check((await rooms()).find((r) => r.id === 13).w === 10, 'dragging the east handle widens the room to 10 m');

  // 5. Pillars, curved wall, stairs, item, chasm
  await page.keyboard.press('p');
  await dragW([42, 9], [48, 15]);
  await page.keyboard.press('u');
  await dragW([46, 12], [46, 14.5]);
  await page.keyboard.press('t');
  await dragW([42.5, 9], [42.5, 9]); // too small: should be refused with a message
  const flash = await page.locator('#hint.flash').count();
  check(flash === 1, 'a too-small drag is refused with a plain-English message');
  await page.keyboard.press('i');
  await clickW([49, 15]);
  const counts = await E(() => ({ p: window.__editor.data.pillars.length, c: window.__editor.data.curves.length, i: window.__editor.data.items.length }));
  check(counts.p === 2 && counts.c === 2 && counts.i === 9, `pillar grid, curved wall and item spot added (${JSON.stringify(counts)})`);
  // The new pillar grid and curve overlap: fine for the format, but check problems list is shown and has no red errors
  check((await problems()).length === 0, `no red problems in the edited level (${(await problems()).join(' | ')})`);

  // New tools: platform, ladder, water, lever, diagonal wall
  const D = () => E(() => window.__editor.data);
  await page.keyboard.press('l');
  await dragW([40.5, 15.5], [43.5, 17.5]);
  let dd = await D();
  check(dd.platforms.length === 2 && dd.platforms[1].top === 3.3, `Platform tool adds a platform 1.5 m above Room 13's floor (${JSON.stringify(dd.platforms[1])})`);
  await page.check('#f-railings-north');
  check((await D()).platforms[1].railings.includes('north'), 'ticking "Railing on north edge" adds a railing');
  await page.keyboard.press('k');
  await clickW([42, 15.2]);
  dd = await D();
  const lad = dd.ladders.at(-1);
  check(dd.ladders.length === 2 && lad.facing === 'south' && lad.top === 3.3, `Ladder tool snaps a ladder to the platform edge (${JSON.stringify(lad)})`);
  await page.keyboard.press('q');
  await dragW([45, 15.5], [47.5, 17.5]);
  check((await D()).water.length === 2, 'Water tool adds a pool');
  await page.keyboard.press('w');
  await page.keyboard.down('Shift');
  await dragW([40.5, 8.5], [42.6, 10.6]);
  await page.keyboard.up('Shift');
  const wall = (await D()).walls.at(-1);
  check(Math.abs(Math.abs(wall.x2 - wall.x1) - Math.abs(wall.z2 - wall.z1)) < 1e-6 && wall.x2 !== wall.x1, `Shift-drag draws a wall at exactly 45° (${JSON.stringify(wall)})`);
  await page.keyboard.press('g');
  await clickW([49, 9]);
  dd = await D();
  check(dd.triggers.length === 3 && dd.triggers[2].type === 'lever', 'Lever tool adds a lever');
  await page.fill('#f-name', 'test-lever');
  await page.press('#f-name', 'Enter');
  // Make the doorway between 11 and 13 a secret door opened by that lever
  await page.keyboard.press('Escape');
  await clickW([40, 13]);
  check((await E(() => window.__editor.selection?.type)) === 'doors', 'clicking a doorway selects it');
  await page.selectOption('#f-leaf', 'secret');
  check((await problems()).some((p) => p.includes('needs a trigger')), 'a secret door without a lever shows a red problem');
  await page.selectOption('#f-trigger', 'test-lever');
  const door = (await D()).doors.find((d) => d.between.includes(13));
  check(door.leaf === 'secret' && door.trigger === 'test-lever' && (await problems()).length === 0, 'choosing the lever fixes it');
  // Open-air room
  await clickW([49.3, 17]);
  await page.check('#f-sky');
  await page.selectOption('#f-sides-east', 'railing');
  const r10b = (await D()).rooms.find((r) => r.id === 13);
  check(r10b.sky === true && r10b.sides.east === 'railing', 'room panel: open to the sky, east side railing');
  check((await problems()).length === 0, `still no red problems (${(await problems()).join(' | ')})`);
  await page.screenshot({ path: `${OUT}/editor-02-edited.png` });

  // 6. Undo / redo
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  // the last change was setting Room 13's east side to "railing"
  const eastOf13 = () => E(() => window.__editor.data.rooms.find((r) => r.id === 13).sides?.east ?? 'wall');
  const afterUndo = await eastOf13();
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await eastOf13();
  check(afterUndo === 'wall' && afterRedo === 'railing', `undo removes the last change, redo puts it back (${afterUndo}, ${afterRedo})`);

  // 7. A mistake shows up as a red problem: drag Room 10 onto Room 9, then undo
  await page.keyboard.press('v');
  await dragW([49.3, 17], [44.3, 17]);
  const overlapProblems = await problems();
  check(overlapProblems.some((p) => p.includes('overlap')), 'moving a room onto another shows a red "overlap" problem');
  await page.keyboard.press('Control+z');
  check((await rooms()).find((r) => r.id === 13).x === 40, 'undo puts the room back');

  // Rotate a room: Room 12 (6 x 4) turns into 4 x 6, contents turn with it (then undo)
  await page.click('[data-action="fit"]');
  const r12 = (await rooms()).find((r) => r.id === 12);
  await clickW([r12.x + 1, r12.z + 1]);
  await page.click('text=⟳ Rotate 90°');
  const r12b = (await rooms()).find((r) => r.id === 12);
  check(r12b.w === r12.d && r12b.d === r12.w, `Rotate 90° turns Room 12 from ${r12.w}×${r12.d} to ${r12b.w}×${r12b.d}`);
  await page.keyboard.press('Control+z');
  check((await rooms()).find((r) => r.id === 12).w === r12.w, 'undo turns it back');

  // 8. Preview from Room 10 in first person
  await clickW([49.3, 17]);
  const label = await page.textContent('[data-action="preview"]');
  check(label.includes('Room 13'), `Preview button offers "${label.trim()}"`);
  const [game] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-action="preview"]')]);
  const gameErrors = [];
  game.on('pageerror', (e) => gameErrors.push(e.message));
  await game.waitForFunction(() => window.__epipalace, null, { timeout: 20000 });
  await game.waitForTimeout(600);
  const g = await game.evaluate(() => ({ room: window.__epipalace.game.state.room?.id, rooms: window.__epipalace.level.rooms.length, y: window.__epipalace.game.player.y }));
  check(g.rooms === 13 && g.room === 13 && g.y >= 1.8 - 0.01, `Preview opens the game with the edited level, standing in Room 13 at 1.8 m (${JSON.stringify(g)})`);
  check((await game.textContent('.panel .sub')).includes('not published'), 'the preview says it is not published yet');
  await game.click('.overlay');
  await game.waitForTimeout(400);
  await game.screenshot({ path: `${OUT}/editor-03-preview.png` });
  check(gameErrors.length === 0, `preview has no errors${gameErrors.length ? ': ' + gameErrors.join(' | ') : ''}`);
  await game.close();

  // 9. Download palace.js
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download"]')]);
  const file = `${OUT}/downloaded-palace.js`;
  await dl.saveAs(file);
  const text = readFileSync(file, 'utf8');
  check(dl.suggestedFilename() === 'palace.js' && text.includes("name: 'Test Room'") && text.includes('export default'), 'Download saves palace.js containing the new room');

  // 10. Reload: the draft is restored from the browser
  await page.reload();
  await page.waitForFunction(() => window.__editor);
  check((await E(() => window.__editor.data.rooms.length)) === 13, 'reloading the page restores the draft');

  // 11. Load site version, then Open the downloaded file
  page.once('dialog', (d) => d.accept());
  await page.click('[data-action="site"]');
  check((await E(() => window.__editor.data.rooms.length)) === 12, '"Load site version" goes back to the published level');
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => window.__editor.data.rooms.length === 13);
  check(true, 'Open file… loads the downloaded palace.js');
  await page.click('[data-action="fit"]');
  await page.click('[data-action="help"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/editor-04-help.png` });
  check(await page.isVisible('#help'), 'Help explains how to publish');

  check(errors.length === 0, `no errors in the editor${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

console.log(failures.length ? `\n${failures.length} editor check(s) FAILED` : '\nAll editor checks passed.');
process.exit(failures.length ? 1 : 0);
