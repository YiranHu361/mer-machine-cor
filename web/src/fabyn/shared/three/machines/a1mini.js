// Bambu Lab A1 mini, measured off the official straight-on product photo (ref/a1mini/a1_front_crop.png,
// 2.41 px per mm: 347 mm wide, cap top at 365 mm) and the published 347 × 315 × 365 mm envelope.
// Built in millimetres, scaled to metres at the end. Seen from the front (+Z): the Z column stands on the
// right on top of the screen block, the X arm cantilevers left over the bed, the bed slides front/back on
// the left block, and one black cable arcs from the toolhead over to the right and down into the base.
export const meta = { name: 'Bambu Lab A1 mini', size_mm: [347, 365, 315] };

export function build(THREE, kit) {
  const root = new THREE.Group();
  const g = new THREE.Group(); g.scale.setScalar(0.001); root.add(g);

  const std = (color, roughness, metalness = 0, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.55, ...extra });
  const M = {
    base: std('#DADBDA', 0.5),
    plinth: std('#8F9194', 0.6),
    alu: std('#C6C8CA', 0.32, 0.7, { envMapIntensity: 0.85 }),
    cover: std('#CDCECE', 0.42, 0.2),
    cap: std('#5E6063', 0.5, 0.1),
    dark: std('#2A2B2D', 0.55),
    darker: std('#161718', 0.35),
    plate: std('#1C1C1E', 0.72),
    white: std('#F0F0ED', 0.45),
    cable: std('#141415', 0.4),
    screw: std('#3A3C3F', 0.35, 0.5),
    fanRing: std('#D8CB57', 0.35, 0, { emissive: '#D8CB57', emissiveIntensity: 0.3 }),
    print: kit.mat.accent,
  };
  const box = (w, h, d, r, mat, x, y, z, parent = g) => { const m = kit.rbox(w, h, d, r, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const cyl = (rt, rb, h, mat, seg = 24) => kit.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const screw = (x, y, z, parent = g, r = 1.6) => { const s = cyl(r, r, 1.2, M.screw, 12); s.rotation.x = Math.PI / 2; s.position.set(x, y, z); parent.add(s); return s; };
  // Printed artwork on a surface: a canvas drawn at 6 px/mm on a plane w × h mm, facing +Z.
  const decal = (w, h, draw, parent, x, y, z, emissive = false) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * 6); cv.height = Math.round(h * 6);
    const c = cv.getContext('2d'); c.scale(6, 6); draw(c, w, h);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = emissive
      ? new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveMap: tex, roughness: 0.12, envMapIntensity: 0.6 })
      : new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, envMapIntensity: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); parent.add(m);
    return { mesh: m, tex, c };
  };
  const text = (c, s, x, y, size, color, weight = 600, font = 'Helvetica Neue, Arial, sans-serif', align = 'left') => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y);
  };

  // ---------- base: left block under the bed, a recessed bridge, the screen block under the column ----------
  box(80, 57, 290, 9, M.base, -38, 32.5, -30);
  box(76, 6, 284, 3, M.plinth, -38, 3, -30);
  box(48, 53, 258, 6, M.base, 24, 30.5, -46);                  // bridge, set back from the front
  box(74, 64, 225, 10, M.base, 83, 36, 2.5);
  box(70, 6, 219, 3, M.plinth, 83, 3, 2.5);
  box(36, 15, 28, 6, M.white, -38, 58, 104);                   // Y belt cover at the front of the rail
  box(22, 4, 250, 1.5, M.dark, -38, 61.5, -32);                // Y rail along the top of the block

  // touchscreen on the front of the screen block
  box(66, 41, 2.6, 4, M.darker, 82.5, 30.5, 114.9);
  const scr = decal(64, 39, () => {}, g, 82.5, 30.5, 116.3, true);
  let lastPct = -1;
  function drawScreen(q) {
    const pct = Math.round(q * 100);
    if (pct === lastPct) return; lastPct = pct;
    const c = scr.c;
    c.fillStyle = '#060707'; c.fillRect(0, 0, 64, 39);
    c.fillStyle = '#0d0f10'; c.fillRect(2, 2, 60, 27);
    text(c, '12:04', 4, 5, 2.6, '#8b9095');
    text(c, '220°C   65°C', 60, 5, 2.6, '#8b9095', 600, undefined, 'right');
    c.fillStyle = '#1d2023'; c.fillRect(4, 9, 15, 15);
    c.fillStyle = '#FF5B1F'; c.fillRect(6.5, 14.5, 10, 4);
    text(c, q <= 0 ? 'Ready' : q >= 1 ? 'Finished' : 'henry_keychain', 22, 12.5, 3.6, '#ececE8', 700);
    c.fillStyle = '#2a2e31'; c.fillRect(22, 17, 37, 2);
    c.fillStyle = '#FF5B1F'; c.fillRect(22, 17, 37 * q, 2);
    text(c, pct + '%', 22, 22.5, 3, '#c9ccd0', 700);
    text(c, 'layer ' + Math.round(q * 30) + '/30', 59, 22.5, 2.6, '#8b9095', 600, undefined, 'right');
    text(c, 'Bambu Lab', 32, 34, 3.4, '#d9dadb', 700, 'Arial Black, Helvetica, sans-serif', 'center');
    scr.tex.needsUpdate = true;
  }

  // ---------- bed: slides along Z on the left block ----------
  const bed = new THREE.Group(); g.add(bed);
  box(70, 10, 74, 3, M.dark, -34.5, 64, 0, bed);               // Y carriage
  box(132, 5, 160, 2, M.dark, -34.5, 71.5, 0, bed);            // frame and bracket feet
  box(186, 3, 186, 1, M.alu, -34.5, 79.5, 0, bed);             // heated bed
  const pei = document.createElement('canvas'); pei.width = pei.height = 256;
  { const c = pei.getContext('2d'); c.fillStyle = '#1c1c1e'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = 22 + Math.random() * 18; c.fillStyle = `rgb(${v},${v},${v + 1})`; c.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4); } }
  const peiTex = new THREE.CanvasTexture(pei); peiTex.colorSpace = THREE.SRGBColorSpace; peiTex.wrapS = peiTex.wrapT = THREE.RepeatWrapping; peiTex.repeat.set(3, 3);
  M.plate.map = peiTex;
  box(188, 4.5, 186, 1.5, M.plate, -34.5, 83.75, 0, bed);      // textured PEI plate, top at 86
  box(30, 1.5, 9, 0.6, M.plate, -112, 85.3, -96, bed);         // grip tab at the back left
  for (let i = 0; i < 9; i++) box(1.2, 1.2, 7, 0.4, M.dark, -124 + i * 3, 86.4, -96, bed);
  const BED_TOP = 86;

  // the print: a flat name keychain with raised block letters (HENRY), grown layer by layer
  const tag = new THREE.Group(); tag.position.set(-35, BED_TOP, 4); bed.add(tag);
  const tagShape = new THREE.Shape();
  { const w = 74, h = 26, r = 6; tagShape.moveTo(-w / 2 + r, -h / 2); tagShape.lineTo(w / 2 - r, -h / 2); tagShape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); tagShape.lineTo(w / 2, h / 2 - r); tagShape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); tagShape.lineTo(-w / 2 + r, h / 2); tagShape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); tagShape.lineTo(-w / 2, -h / 2 + r); tagShape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); }
  const hole = new THREE.Path(); hole.absarc(-29, 0, 4, 0, Math.PI * 2, true); tagShape.holes.push(hole);
  const tagMesh = kit.mesh(new THREE.ExtrudeGeometry(tagShape, { depth: 3, bevelEnabled: false }).rotateX(-Math.PI / 2), M.print); tag.add(tagMesh);
  const letters = new THREE.Group(); letters.position.y = 3; tag.add(letters);
  const stroke = (x, z, w, d, rot = 0) => { const b = kit.mesh(new THREE.BoxGeometry(w, 2, d), M.print); b.position.set(x, 1, z); b.rotation.y = rot; letters.add(b); };
  // letters 8 mm wide on an 11 mm pitch; -z is the top of the letter as read from the front
  const H = x => { stroke(x - 3.4, 0, 2.2, 14); stroke(x + 3.4, 0, 2.2, 14); stroke(x, 0, 5, 2.2); };
  const E = x => { stroke(x - 3, 0, 2.2, 14); stroke(x + 0.6, -5.9, 5.4, 2.2); stroke(x + 0.2, 0, 4.6, 2.2); stroke(x + 0.6, 5.9, 5.4, 2.2); };
  const N = x => { stroke(x - 3.4, 0, 2.2, 14); stroke(x + 3.4, 0, 2.2, 14); stroke(x, 0, 2.2, 14.5, 0.45); };
  const R = x => { stroke(x - 3.2, 0, 2.2, 14); stroke(x, -5.9, 5.6, 2.2); stroke(x + 3.2, -3.2, 2.2, 5.6); stroke(x, -0.6, 5.6, 2.2); stroke(x + 1.7, 3.3, 2.2, 8.2, 0.42); };
  const Y = x => { stroke(x - 2.4, -3.5, 2.2, 8, 0.5); stroke(x + 2.4, -3.5, 2.2, 8, -0.5); stroke(x, 3.5, 2.4, 7); };
  H(-16); E(-5); N(6); R(17); Y(28);
  function setPrint(q) {
    const tq = Math.min(1, q / 0.62), lq = Math.max(0, (q - 0.62) / 0.38);
    tagMesh.scale.y = Math.max(0.001, tq); tagMesh.visible = q > 0;
    letters.scale.y = Math.max(0.001, lq); letters.visible = lq > 0;
    return 3 * tq + 2 * lq;                                    // printed height in mm
  }

  // ---------- Z column on the screen block, with the carry handle near the top ----------
  box(49, 282, 44, 4, M.alu, 86, 68 + 141, -68);
  box(50, 22, 46, 8, M.cap, 86, 355, -68);                     // dark cap, top at 366
  box(1.2, 270, 0.8, 0.3, M.screw, 99, 205, -45.8);            // seam down the front face
  [245, 203, 166, 127, 87].forEach(y => screw(80, y, -45.6));
  box(35, 7, 9, 3, M.white, 109.5, 340, -40);
  box(7, 18, 9, 3, M.white, 123.5, 331, -40);

  // ---------- gantry: Z carriage + label box + X arm, moves up and down as one ----------
  const gantry = new THREE.Group(); g.add(gantry);
  box(56, 58, 54, 4, M.cover, 86, 5, -68, gantry);             // carriage wrapped round the column
  [[70, 18], [70, -14]].forEach(([x, y]) => screw(x, y, -40.6, gantry, 1.5));
  box(56, 54, 58, 5, M.cover, 130, 1, -41, gantry);            // label box, front face at z -12
  decal(52, 50, (c) => {
    text(c, 'Bambu', 4, 8, 4.4, '#46484b', 700, 'Arial Black, Helvetica, sans-serif');
    text(c, 'Lab', 4, 13, 4.4, '#46484b', 700, 'Arial Black, Helvetica, sans-serif');
    text(c, 'A1', 22, 10.5, 12, '#46484b', 500, 'Helvetica Neue, Arial, sans-serif');
    c.strokeStyle = '#46484b'; c.lineWidth = 0.35; c.strokeRect(39.5, 11, 8, 3.6);
    text(c, 'mini', 43.5, 12.9, 2.4, '#46484b', 700, undefined, 'center');
    text(c, 'Caution!', 4, 33, 2.2, '#5c5e61', 600);
    text(c, 'Keep Hands Clear', 4, 36, 2.2, '#5c5e61', 600);
  }, gantry, 130, 1, -11.7);
  { const k = cyl(6, 6, 13, M.dark, 20); k.rotation.z = Math.PI / 2; k.position.set(165, 18, -40); gantry.add(k); }
  box(259, 23, 22, 3, M.alu, -25.5, 0, -32, gantry);           // X arm
  box(257, 1.6, 0.6, 0.3, M.screw, -25.5, 6, -20.8, gantry);   // rail groove
  [-128, -88, 30, 69].forEach(x => screw(x, -2, -20.6, gantry, 1.5));
  { const h = cyl(2.2, 2.2, 1.2, M.darker, 14); h.rotation.x = Math.PI / 2; h.position.set(69, -9, -20.6); gantry.add(h); }
  box(19, 28, 28, 4, M.cap, -164, 0, -32, gantry);             // left end cap
  screw(-164, 2, -17.8, gantry, 1.8);
  box(14, 40, 14, 3, M.cap, -164, -30, -32, gantry);           // hanging bracket
  box(42, 16, 22, 3, M.cap, -152, -52, -32, gantry);           // cutter / wiper block
  { const p = cyl(3, 3, 9, M.cap, 16); p.position.set(-157, -40, -32); gantry.add(p); }
  decal(26, 10, (c) => {
    c.fillStyle = '#121314'; c.fillRect(0, 0, 26, 10);
    c.strokeStyle = '#d9d9d9'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(4, 2.2); c.lineTo(7, 7.6); c.lineTo(1, 7.6); c.closePath(); c.stroke();
    text(c, 'KEEP CLEAR OF', 9, 4, 1.7, '#d9d9d9', 700); text(c, 'MOVING PARTS', 9, 6.6, 1.7, '#d9d9d9', 700);
  }, gantry, -144, -52, -20.8);

  // ---------- toolhead: rides along the arm ----------
  const head = new THREE.Group(); gantry.add(head);
  box(54, 14, 42, 4, M.cap, 0, 60, -14, head);                 // dark top plate behind the cover
  box(52, 87, 60, 7, M.cover, 0, 21.5, -5, head);              // front cover, face at z 25
  [[-21, 61], [21, 61]].forEach(([x, y]) => screw(x, y, 7.8, head, 1.6));
  { const d = cyl(12.5, 12.5, 1.6, M.darker, 40); d.rotation.x = Math.PI / 2; d.position.set(2, 23, 25.2); head.add(d); }
  for (let i = 0; i < 4; i++) {
    const arc = kit.mesh(new THREE.TorusGeometry(8.4, 1.3, 8, 18, Math.PI / 3), M.fanRing);
    arc.position.set(2, 23, 26.1); arc.rotation.z = i * Math.PI / 2 + 0.26; head.add(arc);
  }
  { const hub = cyl(3.4, 3.4, 1.6, M.cover, 20); hub.rotation.x = Math.PI / 2; hub.position.set(2, 23, 26.2); head.add(hub); }
  decal(48, 80, (c) => {
    text(c, 'Remove the cover for', 24, 6, 1.7, '#8f9194', 500, undefined, 'center');
    text(c, 'nozzle / hotend access', 24, 8.4, 1.7, '#8f9194', 500, undefined, 'center');
    text(c, 'Bambu Lab', 24, 63, 4.4, '#55575a', 700, 'Arial Black, Helvetica, sans-serif', 'center');
  }, head, 0, 21.5, 25.35);
  box(54, 18, 46, 5, M.dark, 0, -30.5, 0, head);               // hotend shroud
  decal(16, 9, (c) => {
    c.strokeStyle = '#E6B92E'; c.lineWidth = 0.5;
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(8 + i * 2.2, 1.2); c.bezierCurveTo(9 + i * 2.2, 2.4, 7 + i * 2.2, 3.4, 8 + i * 2.2, 4.6); c.stroke(); }
    text(c, 'CAUTION HOT', 8, 7, 1.7, '#E6B92E', 800, undefined, 'center');
  }, head, 0, -29, 23.2);
  { const n = cyl(3.2, 0.8, 5, M.screw, 16); n.position.set(0, -39.5, 0); head.add(n); }
  { const c1 = cyl(7.5, 7.5, 30, M.white, 24); c1.position.set(0, 80, -2); head.add(c1); }
  { const c2 = cyl(5.5, 5.5, 14, M.cover, 24); c2.position.set(0, 102, -2); head.add(c2); }
  { const c3 = cyl(4, 4, 5, M.dark, 20); c3.position.set(0, 111, -2); head.add(c3); }
  const NOZZLE = -42;                                          // nozzle tip, relative to the arm centre line
  const PARK_Y = 296, PARK_X = -35;                            // where the photo shows it at rest

  // ---------- the cable: toolhead → over the top → clip on the label box → down into the base ----------
  const cable = kit.mesh(new THREE.BufferGeometry(), M.cable); g.add(cable);
  let lastKey = '';
  function cables(aY, hx) {
    const key = aY.toFixed(1) + '|' + hx.toFixed(1);
    if (key === lastKey) return; lastKey = key;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const sag = (PARK_Y - aY) * 0.12;
    const curve = new THREE.CatmullRomCurve3([
      V(hx, aY + 113, -2), V(hx + 3, aY + 135, -4), V(hx + 21, aY + 177, -8), V(52 + (hx - PARK_X) * 0.4, aY + 208, -14),
      V(110, aY + 177, -20), V(127, aY + 135, -24), V(144, aY + 73, -28), V(162, aY + 18, -32),
      V(168 + sag, (aY + 18 + 38) / 2, -40), V(177, 38, -50), V(160, 22, -72), V(122, 20, -90),
    ], false, 'centripetal');
    cable.geometry.dispose(); cable.geometry = new THREE.TubeGeometry(curve, 140, 2.2, 8, false);
  }

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // opts.headX (mm, optional): put the nozzle over this x while printing instead of the idle sweep
  function update(q, t, opts = {}) {
    drawScreen(q);
    const h = setPrint(q);
    const working = q > 0 && q < 1;
    const engage = smooth(0, 0.1, q) * (1 - smooth(0.92, 1, q));
    const printY = BED_TOP + h + 0.4 - NOZZLE;
    const armY = (1 - engage) * PARK_Y + engage * printY;
    const headX = opts.headX !== undefined ? PARK_X + engage * (opts.headX - PARK_X) : PARK_X + engage * (working ? Math.sin(t * 9) * 30 : 0);
    gantry.position.y = armY;
    head.position.x = headX;
    bed.position.z = working ? Math.sin(t * 6.3 + 1) * 12 * engage : 0;
    M.fanRing.emissiveIntensity = working ? 0.55 + 0.3 * Math.sin(t * 20) : 0.3;
    cables(armY, headX);
  }
  update(0, 0);
  // bed (mm space, plate top at bedTop) and the sample tag are exposed so a caller can put its own item on the moving bed
  return { group: root, update, bed, bedTop: BED_TOP, tag };
}
