// Fujifilm instax mini Link 3: phone-photo printer.
// Body 90 x 125 x 37 mm. Tall tapered shell with fine vertical ribs, a glass light panel on the front,
// power and function keys on the left edge, USB-C on the right edge, and a film slot in the top edge.
// Keys, ports and seam bands are tapered with the shell so they sit on its real curved surface.
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const meta = { name: 'instax mini Link 3', size_mm: [90, 125, 37] };

const W = 0.090, H = 0.125, D = 0.037, R = 0.012;
const CW = 460, CH = 620; // picture canvas: instax mini image window 46 x 62 mm at 10 px/mm

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Shell profile (t = 0 at base, 1 at top): narrower across the top, a little shallower toward the top, soft base.
const xScale = (t) => 1 - 0.05 * smooth(0.7, 1, t) - 0.03 * (1 - smooth(0, 0.15, t));
const zScale = (t) => 1 - 0.14 * smooth(0.78, 1, t) - 0.10 * (1 - smooth(0, 0.12, t));

// Applies the shell taper to any geometry already placed in body space (y = height above the base).
function taper(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / H;
    p.setX(i, p.getX(i) * xScale(t));
    p.setZ(i, p.getZ(i) * zScale(t));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Rounded-rectangle outline in the XY plane (works for THREE.Shape and THREE.Path).
function rrPath(P, w, h, r) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  P.moveTo(x0 + r, y0);
  P.lineTo(x1 - r, y0); P.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  P.lineTo(x1, y1 - r); P.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  P.lineTo(x0 + r, y1); P.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  P.lineTo(x0, y0 + r); P.absarc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI, false);
  return P;
}

// Flat rounded ring (outer outline with a hole), extruded by depth along +Z.
function ringGeom(THREE, w, h, r, hw, hh, hr, depth) {
  const s = rrPath(new THREE.Shape(), w, h, r);
  s.holes.push(rrPath(new THREE.Path(), hw, hh, hr));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// The finished picture: the Fabyn logo, painted once, then revealed by developing.
// Mark: a disc built from 14 print layers, the top 4 still unprinted (outlined), over a monoline "fabyn" wordmark.
function paintLogo(canvas) {
  const c = canvas.getContext('2d');
  const rnd = rng(20261024);
  c.fillStyle = '#121213'; c.fillRect(0, 0, CW, CH);

  const cx = CW / 2, cy = 228, r = 112, n = 14, lh = (2 * r) / n;
  for (let i = 0; i < n; i++) {
    const y0 = cy - r + i * lh, ym = y0 + lh / 2;
    const half = Math.sqrt(Math.max(0, r * r - (ym - cy) ** 2));
    c.beginPath(); c.roundRect(cx - half, y0 + 2, half * 2, lh - 4, (lh - 4) / 2);
    if (i >= 4) { c.fillStyle = '#FF5B1F'; c.fill(); }
    else { c.strokeStyle = 'rgba(255,91,31,0.55)'; c.lineWidth = 2; c.stroke(); }
  }
  // the nozzle, parked over the layer it is printing
  const ny = cy - r + 4 * lh, nhalf = Math.sqrt(r * r - (ny + lh / 2 - cy) ** 2);
  c.fillStyle = '#F0F0EC';
  c.beginPath(); c.moveTo(cx + nhalf - 2, ny - 2); c.lineTo(cx + nhalf - 12, ny - 18); c.lineTo(cx + nhalf + 8, ny - 18); c.closePath(); c.fill();

  // wordmark: monoline lowercase, x-height 46, stroke 11
  c.strokeStyle = '#F0F0EC'; c.lineWidth = 11; c.lineCap = 'round'; c.lineJoin = 'round';
  const base = 478, xh = 46, asc = 92;
  const line = (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
  const ring = (x0, y0, rr) => { c.beginPath(); c.arc(x0, y0, rr, 0, Math.PI * 2); c.stroke(); };
  let x = 92;
  c.beginPath(); c.moveTo(x + 14, base); c.lineTo(x + 14, base - asc + 22); c.arc(x + 36, base - asc + 22, 22, Math.PI, Math.PI * 1.75); c.stroke();
  line(x, base - xh, x + 34, base - xh); x += 54;                                                   // f
  ring(x + 23, base - 23, 23); line(x + 47, base - xh, x + 47, base); x += 66;                     // a
  line(x, base - asc, x, base); ring(x + 24, base - 23, 23); x += 66;                              // b
  line(x, base - xh, x + 23, base); line(x + 46, base - xh, x + 12, base + 40); x += 62;           // y
  line(x, base - xh, x, base); c.beginPath(); c.arc(x + 23, base - 23, 23, Math.PI, Math.PI * 2); c.stroke(); line(x + 46, base - 23, x + 46, base); // n

  c.fillStyle = '#8E8E8A'; c.font = '500 19px "Martian Mono", ui-monospace, Menlo, monospace';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('made nearby · cal hacks', cx, 572);

  // fine grain
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    c.fillRect(rnd() * CW, rnd() * CH, 1.5, 1.5);
  }
}

function buildBody(THREE, kit) {
  let g = new kit.RoundedBoxGeometry(W, H, D, 10, R);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-6);
  g.translate(0, H / 2, 0);
  taper(g);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i));
    // ribs run vertically: u follows x on the front and back, z on the sides
    uv[2 * i] = (az >= ax ? p.getX(i) : p.getZ(i)) / W + 0.5;
    uv[2 * i + 1] = p.getY(i) / H;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function build(THREE, kit) {
  const { mat, mesh, rbox, PALETTE, RoundedBoxGeometry } = kit;
  const group = new THREE.Group();

  // a mesh placed in body space and tapered with the shell
  const piece = (g, material, x = 0, y = 0, z = 0) => { g.translate(x, y, z); return mesh(taper(g), material); };

  // ribbed shell: a narrow-valley rib profile at about 1.5 mm pitch, used as a soft bump
  const ribC = mkCanvas(64, 4);
  const rc = ribC.getContext('2d');
  for (let x = 0; x < 64; x++) {
    const v = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / 64), 3);
    const g = Math.round(140 + 115 * v);
    rc.fillStyle = `rgb(${g},${g},${g})`;
    rc.fillRect(x, 0, 1, 4);
  }
  const ribTex = new THREE.CanvasTexture(ribC);
  ribTex.wrapS = ribTex.wrapT = THREE.RepeatWrapping;
  ribTex.repeat.set(60, 1); // about 1.5 mm rib pitch across the 90 mm width

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.shell, roughness: 0.40, clearcoat: 0.55, clearcoatRoughness: 0.18,
    bumpMap: ribTex, bumpScale: 0.55, envMapIntensity: 0.85,
  });
  group.add(mesh(buildBody(THREE, kit), bodyMat));

  // two-part look: a flush graphite seam band around the middle of the shell
  group.add(piece(
    ringGeom(THREE, W + 0.0001, D + 0.00002, R + 0.00005, W - 0.0004, D - 0.0004, R - 0.0002, 0.00025).rotateX(-Math.PI / 2),
    mat.graphite, 0, 0.0595, 0));
  // graphite foot band around the base
  group.add(piece(
    ringGeom(THREE, W + 0.0002, D + 0.00002, R + 0.0001, W - 0.0008, D - 0.0008, R - 0.0004, 0.004).rotateX(-Math.PI / 2),
    mat.graphite, 0, 0, 0));

  // top film slot: graphite ring cut into the top face, a dark plate in the opening, flush with the ring
  group.add(piece(
    ringGeom(THREE, 0.0600, 0.0036, 0.0008, 0.0560, 0.0016, 0.0004, 0.0005).rotateX(-Math.PI / 2),
    mat.graphite, 0, H - 0.0003, 0));
  group.add(piece(new THREE.BoxGeometry(0.0560, 0.0003, 0.0016), mat.dark, 0, H + 0.00005, 0));

  // front light panel: a diffused glass sheet with a soft vertical glow, a 2% grid, and a halo ring
  const panelC = mkCanvas(128, 512);
  const pc = panelC.getContext('2d');
  for (let y = 0; y < 512; y++) {
    const v = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (y / 512 - 0.5)));
    pc.fillStyle = `rgb(${Math.round(255 * v)},${Math.round((105 + 70 * v) * v)},${Math.round((50 + 40 * v) * v)})`;
    pc.fillRect(0, y, 128, 1);
  }
  pc.fillStyle = 'rgba(0,0,0,0.035)';
  for (let x = 0; x < 128; x += 8) pc.fillRect(x, 0, 1, 512);
  for (let y = 0; y < 512; y += 8) pc.fillRect(0, y, 128, 1);
  const panelTex = new THREE.CanvasTexture(panelC);
  panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping;
  panelTex.colorSpace = THREE.SRGBColorSpace;
  const panelMat = new THREE.MeshPhysicalMaterial({
    color: '#17181a', roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: '#ffffff', emissiveMap: panelTex, emissiveIntensity: 0.9,
  });
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ff7a3a', transparent: true, opacity: 0.14, depthWrite: false });
  const frame = rbox(0.034, 0.084, 0.0006, 0.003, mat.graphite);
  frame.position.set(0, 0.059, D / 2 + 0.0001);
  group.add(frame);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.033, 0.082), haloMat);
  halo.position.set(0, 0.059, D / 2 + 0.0004);
  group.add(halo);
  const panel = mesh(new THREE.PlaneGeometry(0.031, 0.080), panelMat);
  panel.position.set(0, 0.059, D / 2 + 0.00045);
  group.add(panel);

  // left edge: power and function keys sit in graphite bezels; their faces protrude less than 0.3 mm
  const leftPiece = (thick, h, w, r, offset, y, z, material) => {
    const g = new RoundedBoxGeometry(thick, h, w, 2, r);
    return piece(g, material, -(W / 2 + offset - thick / 2), y, z);
  };
  group.add(leftPiece(0.0006, 0.0192, 0.0107, 0.0002, 0.0001, 0.101, 0, mat.graphite));
  group.add(leftPiece(0.0022, 0.018, 0.0095, 0.0008, 0.0003, 0.101, 0, mat.dark));
  group.add(leftPiece(0.0006, 0.0122, 0.0097, 0.0002, 0.0001, 0.0825, 0, mat.graphite));
  group.add(leftPiece(0.0022, 0.011, 0.0085, 0.0008, 0.0003, 0.0825, 0, mat.dark));

  // status LED in a small dark recess between the two keys
  const ledMat = mat.led.clone();
  group.add(piece(new THREE.CircleGeometry(0.00085, 20).rotateY(-Math.PI / 2), mat.dark, -(W / 2 + 0.00003), 0.09, 0));
  group.add(piece(new THREE.CircleGeometry(0.0006, 16).rotateY(-Math.PI / 2), ledMat, -(W / 2 + 0.00008), 0.09, 0));

  // right edge: USB-C in a raised graphite ring with a dark port face
  group.add(piece(
    ringGeom(THREE, 0.0085, 0.0045, 0.0012, 0.0055, 0.0026, 0.0006, 0.0004).rotateY(Math.PI / 2),
    mat.graphite, W / 2 - 0.0003, 0.062, 0));
  group.add(piece(new THREE.BoxGeometry(0.0006, 0.0026, 0.0055), mat.dark, W / 2 - 0.00025, 0.062, 0));

  // film card: 54 x 86 mm white frame, the image window 46 x 62 mm at the leading (top) end
  const cardGroup = new THREE.Group();
  cardGroup.add(mesh(new THREE.BoxGeometry(0.054, 0.086, 0.0004), mat.paper));
  const picC = mkCanvas(CW, CH);
  const picCtx = picC.getContext('2d');
  const sceneC = mkCanvas(CW, CH);
  paintLogo(sceneC);

  // developing stages, all prepared once: grey and coarse, grey and soft, colour and soft, colour and sharp.
  // Each stage is a full picture over a dark ground; update() cross-fades between two neighbours.
  const lvl = (src, div) => {
    const s = mkCanvas(Math.round(CW / div), Math.round(CH / div));
    s.getContext('2d').drawImage(src, 0, 0, s.width, s.height);
    const o = mkCanvas(CW, CH);
    o.getContext('2d').drawImage(s, 0, 0, CW, CH); // upscaling a small copy gives the blur
    return o;
  };
  const greyed = (src) => {
    const o = mkCanvas(CW, CH);
    const c = o.getContext('2d');
    c.drawImage(src, 0, 0);
    const img = c.getImageData(0, 0, CW, CH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    c.putImageData(img, 0, 0);
    return o;
  };
  const stage = (src, alpha) => {
    const o = mkCanvas(CW, CH);
    const c = o.getContext('2d');
    c.fillStyle = '#2a2c2e'; c.fillRect(0, 0, CW, CH);
    c.globalAlpha = alpha; c.drawImage(src, 0, 0); c.globalAlpha = 1;
    return o;
  };
  const stages = [
    stage(greyed(lvl(sceneC, 14)), 0.5),
    stage(greyed(lvl(sceneC, 3)), 0.8),
    stage(lvl(sceneC, 2), 0.92),
    stage(sceneC, 1),
  ];
  const picTex = new THREE.CanvasTexture(picC);
  picTex.colorSpace = THREE.SRGBColorSpace;
  picTex.anisotropy = 4;
  const picMat = new THREE.MeshPhysicalMaterial({ map: picTex, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  const image = mesh(new THREE.PlaneGeometry(0.046, 0.062), picMat);
  image.position.set(0, 0.008, 0.00025);
  cardGroup.add(image);
  const H0 = H - 0.053; // card centre at rest: fully inside the shell
  cardGroup.position.set(0, H0, 0);
  group.add(cardGroup);

  const drawFrame = (dev) => {
    const x = clamp01(dev) * 3;
    const i = Math.min(2, Math.floor(x));
    const f = x - i;
    picCtx.globalAlpha = 1;
    picCtx.drawImage(stages[i], 0, 0);
    if (f > 0.001) {
      picCtx.globalAlpha = f;
      picCtx.drawImage(stages[i + 1], 0, 0);
      picCtx.globalAlpha = 1;
    }
  };
  let lastDev = -1;

  return {
    group,
    update(q, t) {
      const e = smooth(0, 1, q);
      // card feeds upward out of the top slot as q grows (0 = inside, 1 = fully out, bottom edge clear of the slot)
      cardGroup.position.y = H0 + e * 0.100;
      cardGroup.visible = q > 0.002;
      const printing = q > 0.002 && q < 0.998;
      const pulse = printing ? 0.5 + 0.5 * Math.sin(t * 10) : 0;

      const dev = clamp01((q - 0.45) / 0.55);
      if (lastDev < 0 || Math.abs(dev - lastDev) > 0.008 || (dev === 1 && lastDev !== 1)) {
        drawFrame(dev);
        picTex.needsUpdate = true;
        lastDev = dev;
      }

      panelMat.emissiveIntensity = printing ? 0.9 + 0.5 * pulse : (q >= 0.998 ? 0.9 : 0.7 + 0.1 * Math.sin(t * 1.5));
      haloMat.opacity = printing ? 0.16 + 0.1 * pulse : 0.14;
      ledMat.emissiveIntensity = printing ? 3.0 + 2.5 * pulse : (q >= 0.998 ? 1.6 : 1.0 + 0.2 * Math.sin(t * 1.5));
      if (printing) panelTex.offset.y = (t * 0.12) % 1; // the light sweeps while printing
      // a slight vibration while feeding, then the card droops a little once it has cleared the slot
      cardGroup.rotation.x = (printing ? Math.sin(t * 47) * 0.0008 : 0) - 0.02 * smooth(0.9, 1, q);
    },
  };
}
