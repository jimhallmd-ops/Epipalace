// Reading and writing the level file (src/level/palace.js) for the map editor.
// The editor writes a normal, readable palace.js: one room/door/etc. per line.

const SECTION_ORDER = ['name', 'defaults', 'spawn', 'rooms', 'doors', 'chasms', 'walls', 'stairs', 'ramps', 'curves', 'pillars', 'items'];

const HEADER = `// ============================================================================
//  EPIPALACE LEVEL FILE (the one place where the palace layout is defined)
// ============================================================================
//  Made with the map editor (epipalace.com/editor). The editor can open this
//  file again, so the easiest way to change the layout is to use the editor.
//  The format is described in PROJECT.md, section "Level format".
//
//  Both the 3D visuals AND the collision are built from this file.
//  Units are metres. x = east (right on the map), z = south (down on the map).
// ============================================================================

`;

const round = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Writes a value as a compact, readable JavaScript literal on one line. */
export function literal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(round(v));
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(v)) return `[${v.map(literal).join(', ')}]`;
  const parts = Object.entries(v)
    .filter(([, val]) => val !== undefined)
    .map(([k, val]) => `${IDENT.test(k) ? k : literal(k)}: ${literal(val)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** The full text of a palace.js file for this level data. */
export function toPalaceJS(data) {
  const keys = [...SECTION_ORDER.filter((k) => k in data), ...Object.keys(data).filter((k) => !SECTION_ORDER.includes(k))];
  const lines = [];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) {
        lines.push(`  ${k}: [],`);
        continue;
      }
      lines.push(`  ${k}: [`);
      for (const item of v) lines.push(`    ${literal(item)},`);
      lines.push('  ],');
    } else {
      lines.push(`  ${k}: ${literal(v)},`);
    }
    lines.push('');
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return `${HEADER}export default {\n${lines.join('\n')}\n};\n`;
}

/**
 * Reads a level file's text (a palace.js module, or plain JSON) into level data.
 * `importer` loads a JavaScript module from text; browsers and tests supply their own.
 */
export async function parseLevelText(text, importer) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  if (!/export\s+default/.test(text)) throw new Error('This does not look like a level file (no "export default" found).');
  const mod = await importer(text);
  if (!mod || typeof mod.default !== 'object') throw new Error('The file does not export a level.');
  return mod.default;
}

/** Browser importer: loads the module text through a temporary blob URL. */
export async function browserImporter(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
