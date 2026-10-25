// Phomemo M02 Pro: pocket thermal sticker printer, 85 x 85 x 46 mm (Phomemo spec sheet).
// Precision-cast look: one satin shell material for body and lid, a body with tight
// vertical corners and small horizontal bevels, a lid that overhangs the body by 0.3 mm,
// a flush paper slot on the top front edge, a round power key on the front face and a
// single status LED on the lid. The sticker feeds out of the slot, turns over a tight
// 3 mm radius and hangs straight down in front of the unit, cupped across its width.
// Origin is bottom centre, +Y up, front faces +Z. The sticker bounding box extends a
// few mm past the 46 mm depth; meta.size_mm is the spec value.
export const meta = { name: 'Phomemo M02 Pro', size_mm: [85, 85, 46] };

const STICKER_W = 0.053;   // 53 mm paper roll
const STICKER_L = 0.085;   // printed length at q = 1
const ROWS = 72;           // ribbon segments along the sticker
const COLS = 7;            // ribbon samples across the sticker (for the cupped curl)
const ALPHA = 0.4;         // row spacing: denser near the slot where the bend is tight
const BEND_R = 0.003;      // radius of the tight turn at the slot
const ARC = (Math.PI / 2) * BEND_R; // arc length of that turn

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (x) => x * x * (3 - 2 * x);

// Bend angle of the sticker at arc length s (metres from the slot).
// 0 = leaving straight forward (+Z); -pi/2 = hanging straight down.
const bend = (s) => -(Math.PI / 2) * smooth(clamp01(s / ARC));

export function build(THREE, kit) {
  const { mat, rbox, mesh, PALETTE } = kit;
  const group = new THREE.Group();

  // ---------- textures drawn in code ----------
  const TW = 424, TH = 680; // 1x layout: 8 px per mm, 53 x 85 mm label
  const SS = 2;             // drawn at 2x, then dithered to 1 bit on that grid

  function fitText(g, s, maxW, cy, px) {
    let size = px;
    g.font = `900 ${size}px "Arial Black", Arial, Helvetica, sans-serif`;
    const w = g.measureText(s).width;
    if (w > maxW) size = (size * maxW) / w;
    g.font = `900 ${size}px "Arial Black", Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, TW / 2, cy);
  }

  function makeStickerTexture() {
    const W2 = TW * SS, H2 = TH * SS;
    const c = document.createElement('canvas');
    c.width = W2; c.height = H2;
    const g = c.getContext('2d');
    g.setTransform(SS, 0, 0, SS, 0, 0); // everything below uses 1x label coordinates
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#000000';
    g.strokeStyle = '#000000';
    g.lineCap = 'round';

    // dotted die-cut frame
    g.lineWidth = 3;
    g.setLineDash([5, 7]);
    g.strokeRect(12, 12, TW - 24, TH - 24);
    g.setLineDash([]);

    // smiley: solid disc with white eyes and a white smile, drawn at 0.88 scale
    // high enough that its chin clears the top of the HBD lettering
    g.save();
    g.translate(TW / 2, 166);
    g.scale(0.88, 0.88);
    g.fillStyle = '#000000';
    g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(-34, -22, 11, 17, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(34, -22, 11, 17, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = 12; g.strokeStyle = '#ffffff';
    g.beginPath(); g.arc(0, 4, 50, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke();
    g.restore();

    // lettering
    g.fillStyle = '#000000';
    fitText(g, 'YIRAN', 380, 400, 190);
    g.font = '700 30px "Arial Black", Arial, Helvetica, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CAL HACKS 13', TW / 2, 500);

    // thin rule, a fake barcode and a dashed cut line above the bottom edge
    g.fillRect(56, 548, TW - 112, 3);
    let seed = 526;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let x = 70;
    while (x < TW - 70) {
      const w = 2 + Math.floor(rnd() * 4);
      if (rnd() > 0.3) g.fillRect(x, 580, w, 60);
      x += w + 2 + Math.floor(rnd() * 3);
    }
    g.strokeStyle = '#444444';
    g.lineWidth = 2;
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(24, 656); g.lineTo(TW - 24, 656); g.stroke();
    g.setLineDash([]);

    // Floyd-Steinberg dither to 1 bit: the thermal-head look
    const img = g.getImageData(0, 0, W2, H2);
    const d = img.data;
    const N = W2 * H2;
    const lum = new Float32Array(N);
    for (let p = 0; p < N; p++) lum[p] = d[p * 4];
    const spread = (x0, y0, e, k) => {
      if (x0 < 0 || x0 >= W2 || y0 >= H2) return;
      lum[y0 * W2 + x0] += e * k;
    };
    for (let y = 0; y < H2; y++) {
      for (let x2 = 0; x2 < W2; x2++) {
        const i = y * W2 + x2;
        const old = lum[i];
        const nw = old < 128 ? 0 : 255;
        const err = old - nw;
        lum[i] = nw;
        spread(x2 + 1, y, err, 7 / 16);
        spread(x2 - 1, y + 1, err, 3 / 16);
        spread(x2, y + 1, err, 5 / 16);
        spread(x2 + 1, y + 1, err, 1 / 16);
      }
    }
    for (let p = 0; p < N; p++) {
      const v = lum[p];
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
      d[p * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;           // soft dot edges, no stair-steps
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    return tex;
  }

  // power glyph on a transparent canvas, so only the strokes land on the cap
  function makePowerIconTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = '#8E8F92';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(64, 72, 30, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6 + Math.PI * 2);
    g.stroke();
    g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 68); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  // ---------- materials ----------
  // One satin shell material for body, lid and cap, so nothing reads as a second plastic.
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.shell, roughness: 0.42, metalness: 0,
    clearcoat: 0.4, clearcoatRoughness: 0.25, envMapIntensity: 0.6,
  });
  const shellGreyMat = new THREE.MeshStandardMaterial({ color: PALETTE.shellGrey, roughness: 0.5, envMapIntensity: 0.45 });
  const ledMat = mat.led.clone();
  const paperMat = new THREE.MeshStandardMaterial({
    map: makeStickerTexture(), color: '#F7F6F1', roughness: 0.88, side: THREE.DoubleSide,
  });
  const iconMat = new THREE.MeshStandardMaterial({
    map: makePowerIconTexture(), transparent: true, depthWrite: false, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  // Rounded slab: a rounded-rectangle footprint (corner radius rv in plan, so the vertical
  // corners are rv) extruded between yBot and yTop, with a bevel of size b on all edges.
  // ExtrudeGeometry grows the outline by the bevel size, so the footprint is inset by b.
  function slabGeometry(W, D, rv, b, bt, yBot, yTop) {
    const hw = W / 2 - b, hd = D / 2 - b, r = Math.max(0.0005, rv - b);
    const shape = new THREE.Shape();
    shape.moveTo(hw - r, -hd);
    shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
    shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
    shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
    shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: (yTop - yBot) - 2 * bt,
      bevelEnabled: true, bevelThickness: bt, bevelSize: b, bevelOffset: 0,
      bevelSegments: 8, curveSegments: 24, steps: 1,
    });
    geo.rotateX(-Math.PI / 2);          // extrusion axis Z -> Y
    geo.translate(0, yBot + bt, 0);     // bottom cap at yBot, top cap at yTop
    return geo;
  }

  // ---------- body ----------
  // Main shell: 84.4 wide, 46 deep bottom block, sits on four small feet.
  const bodyGeo = slabGeometry(0.0844, 0.0456, 0.0075, 0.0018, 0.0018, 0.0006, 0.0788);
  const body = mesh(bodyGeo, shellMat);
  group.add(body);

  // Four rubber feet under the body, inset from the corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot = rbox(0.0100, 0.0006, 0.0080, 0.0003, mat.dark);
    foot.position.set(sx * 0.0300, 0.0003, sz * 0.0140);
    group.add(foot);
  }

  // Dark seam: a thin slit between the body top and the lid underside.
  const seam = rbox(0.0814, 0.0006, 0.0430, 0.0002, mat.dark);
  seam.position.set(0, 0.0789, 0);
  group.add(seam);

  // Lid: overhangs the body by about 0.3 mm all round, top face at 85 mm.
  const lidGeo = slabGeometry(0.0850, 0.0462, 0.0078, 0.0014, 0.0014, 0.0792, 0.0850);
  const lid = mesh(lidGeo, shellMat);
  group.add(lid);

  // Hinge: a short graphite knuckle buried in the back of the seam.
  const hingeGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 0.040, 24);
  hingeGeo.rotateZ(Math.PI / 2);
  const hinge = mesh(hingeGeo, mat.graphite);
  hinge.position.set(0, 0.0790, -0.0214);
  group.add(hinge);

  // Thumb grooves: shallow dark slots flush with the lid sides.
  for (const sx of [-1, 1]) {
    const notch = rbox(0.0010, 0.0026, 0.0120, 0.0004, mat.dark);
    notch.position.set(sx * 0.04245, 0.0821, 0);
    group.add(notch);
  }

  // Five fine vent slits on the lid, toward the back.
  for (let i = 0; i < 5; i++) {
    const vent = rbox(0.0280, 0.0006, 0.0006, 0.0002, mat.graphite);
    vent.position.set(0, 0.0850, -0.0110 + i * 0.0048);
    group.add(vent);
  }

  // ---------- paper exit slot (top front edge) ----------
  // A dark strip set into the lid top; the sticker leaves over it.
  const slot = rbox(0.0525, 0.0004, 0.0024, 0.0001, mat.dark);
  slot.position.set(0, 0.0849, 0.0212);
  group.add(slot);

  // ---------- power key on the front face ----------
  // Flush recessed ring, low satin cap with a rounded top edge, grey glyph.
  const ringGeo = new THREE.RingGeometry(0.0082, 0.0090, 72);
  const ring = mesh(ringGeo, mat.dark);
  ring.position.set(0, 0.0200, 0.02285);
  group.add(ring);

  const capProfile = [
    [0, 0], [0.0072, 0], [0.0078, 0.0001], [0.0080, 0.0003], [0.0080, 0.0006],
    [0.0077, 0.0009], [0.0070, 0.0010], [0, 0.0010],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const capGeo = new THREE.LatheGeometry(capProfile, 64);
  capGeo.rotateX(Math.PI / 2);          // lathe axis Y -> Z, cap faces +Z
  const cap = mesh(capGeo, shellMat);
  cap.position.set(0, 0.0200, 0.0227);
  group.add(cap);

  const iconGeo = new THREE.CircleGeometry(0.0068, 64);
  const icon = mesh(iconGeo, iconMat);
  icon.position.set(0, 0.0200, 0.02385);
  group.add(icon);

  // ---------- status LED on the lid, front-left ----------
  const ledRingGeo = new THREE.CylinderGeometry(0.0017, 0.0017, 0.0003, 28);
  const ledRing = mesh(ledRingGeo, shellGreyMat);
  ledRing.position.set(-0.0225, 0.08515, 0.0125);
  group.add(ledRing);
  const ledGeo = new THREE.CylinderGeometry(0.0010, 0.0010, 0.0005, 20);
  const led = mesh(ledGeo, ledMat);
  led.position.set(-0.0225, 0.08525, 0.0125);
  group.add(led);

  // ---------- the sticker ----------
  const vcount = (ROWS + 1) * COLS;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Float32Array(vcount * 3);
  const uvs = new Float32Array(vcount * 2);
  const index = [];
  const P0y = 0.0852, P0z = 0.0222; // slot exit point, just above the lid top
  for (let i = 0; i <= ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const k = i * COLS + j;
      const u = j / (COLS - 1);
      pos[k * 3] = -STICKER_W / 2 + u * STICKER_W;
      pos[k * 3 + 1] = P0y;
      pos[k * 3 + 2] = P0z;
      nrm[k * 3 + 1] = 1;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = 1 - i / ROWS; // row 0 (leaving the printer) is the top of the print
    }
  }
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS - 1; j++) {
      const a = i * COLS + j, b = a + 1, c = a + COLS, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const stickerGeo = new THREE.BufferGeometry();
  stickerGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stickerGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  stickerGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  stickerGeo.setIndex(index);
  const sticker = mesh(stickerGeo, paperMat);
  sticker.frustumCulled = false; // geometry is rewritten every frame
  sticker.visible = false;
  group.add(sticker);

  // scratch arrays for the centreline, reused every frame
  const cy = new Float32Array(ROWS + 1);
  const cz = new Float32Array(ROWS + 1);
  const cth = new Float32Array(ROWS + 1);
  const csA = new Float32Array(ROWS + 1);

  // ---------- animation ----------
  function updateSticker(q, t) {
    const working = q > 0 && q < 1;
    let L = STICKER_L * q;
    if (working) L += 0.00055 * Math.sin(t * 23) * Math.sin(Math.PI * q); // stepper feed chatter
    L = Math.max(0, L);

    // centreline: integrate the bend along arc length, rows denser near the slot
    let prevS = 0;
    cy[0] = P0y; cz[0] = P0z; cth[0] = 0; csA[0] = 0;
    for (let i = 1; i <= ROWS; i++) {
      const tt = i / ROWS;
      const s = L * (ALPHA * tt + (1 - ALPHA) * tt * tt);
      const th = bend((prevS + s) * 0.5);
      cy[i] = cy[i - 1] + (s - prevS) * Math.sin(th);
      cz[i] = cz[i - 1] + (s - prevS) * Math.cos(th);
      cth[i] = bend(s);
      csA[i] = s;
      prevS = s;
    }
    cth[0] = bend(0);

    // ribbon: cupping curl across the width, growing toward the tip
    for (let i = 0; i <= ROWS; i++) {
      const curl = 0.0032 * smooth(Math.min(1, csA[i] / STICKER_L));
      const th = cth[i];
      const ny = Math.cos(th), nz = -Math.sin(th); // unit normal of the ribbon in YZ
      for (let j = 0; j < COLS; j++) {
        const k = i * COLS + j;
        const u = j / (COLS - 1);
        const lift = curl * (2 * u - 1) * (2 * u - 1);
        pos[k * 3 + 1] = cy[i] + ny * lift;
        pos[k * 3 + 2] = cz[i] + nz * lift;
        nrm[k * 3 + 1] = ny;
        nrm[k * 3 + 2] = nz;
      }
    }
    stickerGeo.attributes.position.needsUpdate = true;
    stickerGeo.attributes.normal.needsUpdate = true;
  }

  function update(q, t) {
    q = clamp01(q);
    const working = q > 0 && q < 1;

    // status LED: steady dim when idle, fast blink while printing, solid when done
    if (q >= 1) ledMat.emissiveIntensity = 1.6;
    else if (working) ledMat.emissiveIntensity = Math.sin(t * 9) > -0.1 ? 3.0 : 0.22;
    else ledMat.emissiveIntensity = 0.35;

    sticker.visible = q > 0.002;
    if (sticker.visible) updateSticker(q, t);
  }

  return { group, update };
}
