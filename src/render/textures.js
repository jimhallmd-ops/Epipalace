// Small textures drawn in code (no image files needed).
import * as THREE from 'three';

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** 1 m floor tiles: white with soft grout lines (tinted by the room colour). */
export function floorTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.05)';
    g.lineWidth = 2;
    g.strokeRect(s * 0.25, s * 0.25, s * 0.5, s * 0.5);
  });
}

/** Plaster walls with faint 1 m panel lines, so you can judge distance and speed. */
export function wallTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(0, 0, 3, s);
    g.fillRect(0, s - 3, s, 3);
  });
}

/** A big number with an optional caption, e.g. for floor markings and door signs. */
export function labelTexture(text, caption = '', { bg = 'rgba(0,0,0,0)', fg = '#1d3557', w = 512, h = 512 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.floor(h * (caption ? 0.55 : 0.7))}px system-ui, sans-serif`;
  g.fillText(text, w / 2, caption ? h * 0.4 : h / 2);
  if (caption) {
    let size = Math.floor(h * 0.13);
    g.font = `600 ${size}px system-ui, sans-serif`;
    while (g.measureText(caption).width > w * 0.95 && size > 10) {
      size -= 2;
      g.font = `600 ${size}px system-ui, sans-serif`;
    }
    g.fillText(caption, w / 2, h * 0.82);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
