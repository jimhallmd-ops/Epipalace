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
  check((await E(() => window.__editor.data.rooms.length)) === 9, 'editor loads the current level (9 rooms)');
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
  await page.evaluate(() => (window.__editor.view.x += 8));
  await page.keyboard.press('r');
  await dragW([34, 8], [42, 16]);
  await page.click('[data-action="fit"]');
  let rs = await rooms();
  const r10 = rs.find((r) => r.id === 10);
  check(r10 && r10.x === 34 && r10.z === 8 && r10.w === 8 && r10.d === 8, `drag with the Room tool draws Room 10 at 34,8 size 8×8 (${JSON.stringify(r10 && [r10.x, r10.z, r10.w, r10.d])})`);
  check((await E(() => window.__editor.selection?.type)) === 'rooms', 'the new room is selected, and the tool returns to Select');

  // 2. Set its floor height in the panel to match Room 9 (1.8 m) and rename it
  await page.fill('#f-floor', '1.8');
  await page.press('#f-floor', 'Enter');
  await page.fill('#f-name', 'Test Room');
  await page.press('#f-name', 'Enter');
  rs = await rooms();
  check(rs.find((r) => r.id === 10).floor === 1.8 && rs.find((r) => r.id === 10).name === 'Test Room', 'panel edits change the floor height and the name');

  // 3. Doorway between 9 and 10
  await page.keyboard.press('d');
  await clickW([34, 12]);
  const doors = await E(() => window.__editor.data.doors);
  check(doors.some((d) => d.between.includes(9) && d.between.includes(10)), 'Door tool: clicking the shared wall adds a doorway between Rooms 9 and 10');

  // 4. Resize the room by dragging its east handle from x=42 to x=44
  await clickW([38, 12]);
  await dragW([42, 12], [44, 12]);
  check((await rooms()).find((r) => r.id === 10).w === 10, 'dragging the east handle widens the room to 10 m');

  // 5. Pillars, curved wall, stairs, item, chasm
  await page.keyboard.press('p');
  await dragW([36, 9], [42, 15]);
  await page.keyboard.press('u');
  await dragW([40, 12], [40, 14.5]);
  await page.keyboard.press('t');
  await dragW([36.5, 9], [36.5, 9]); // too small: should be refused with a message
  const flash = await page.locator('#hint.flash').count();
  check(flash === 1, 'a too-small drag is refused with a plain-English message');
  await page.keyboard.press('i');
  await clickW([43, 15]);
  const counts = await E(() => ({ p: window.__editor.data.pillars.length, c: window.__editor.data.curves.length, i: window.__editor.data.items.length }));
  check(counts.p === 2 && counts.c === 2 && counts.i === 7, `pillar grid, curved wall and item spot added (${JSON.stringify(counts)})`);
  // The new pillar grid and curve overlap: fine for the format, but check problems list is shown and has no red errors
  check((await problems()).length === 0, `no red problems in the edited level (${(await problems()).join(' | ')})`);
  await page.screenshot({ path: `${OUT}/editor-02-edited.png` });

  // 6. Undo / redo
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  const afterUndo = await E(() => window.__editor.data.items.length);
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await E(() => window.__editor.data.items.length);
  check(afterUndo === 6 && afterRedo === 7, `undo removes the last change, redo puts it back (${afterUndo}, ${afterRedo})`);

  // 7. A mistake shows up as a red problem: drag Room 10 onto Room 9, then undo
  await page.keyboard.press('v');
  await dragW([39, 15.5], [35, 15.5]);
  const overlapProblems = await problems();
  check(overlapProblems.some((p) => p.includes('overlap')), 'moving a room onto another shows a red "overlap" problem');
  await page.keyboard.press('Control+z');
  check((await rooms()).find((r) => r.id === 10).x === 34, 'undo puts the room back');

  // 8. Preview from Room 10 in first person
  await clickW([38, 10.5]);
  const label = await page.textContent('[data-action="preview"]');
  check(label.includes('Room 10'), `Preview button offers "${label.trim()}"`);
  const [game] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-action="preview"]')]);
  const gameErrors = [];
  game.on('pageerror', (e) => gameErrors.push(e.message));
  await game.waitForFunction(() => window.__epipalace, null, { timeout: 20000 });
  await game.waitForTimeout(600);
  const g = await game.evaluate(() => ({ room: window.__epipalace.game.state.room?.id, rooms: window.__epipalace.level.rooms.length, y: window.__epipalace.game.player.y }));
  check(g.rooms === 10 && g.room === 10 && Math.abs(g.y - 1.8) < 0.01, `Preview opens the game with the edited level, standing in Room 10 at 1.8 m (${JSON.stringify(g)})`);
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
  check((await E(() => window.__editor.data.rooms.length)) === 10, 'reloading the page restores the draft');

  // 11. Load site version, then Open the downloaded file
  page.once('dialog', (d) => d.accept());
  await page.click('[data-action="site"]');
  check((await E(() => window.__editor.data.rooms.length)) === 9, '"Load site version" goes back to the published level');
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => window.__editor.data.rooms.length === 10);
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
