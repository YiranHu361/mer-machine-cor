// The homepage 3D scene: a faithful port of web/fabyn-reference/hero.html.
// Same machines, same 18 s camera timeline, same map and arcs. The overlay
// (nav, labels, CTA) is React; this file only drives the canvas and the
// overlay nodes it is handed. Call the returned function to clean up.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { makeKit } from "../shared/three/kit.js";
import * as a1mini from "../shared/three/machines/a1mini.js";
import * as m02pro from "../shared/three/machines/m02pro.js";
import * as instax from "../shared/three/machines/instax.js";
import type { MachineModel } from "../shared/three/machines/machine";

const T = 18;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x: number) => {
  x = clamp(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeIn = (x: number) => {
  x = clamp(x);
  return x * x * x;
};
const easeOut = (x: number) => {
  x = clamp(x);
  return 1 - Math.pow(1 - x, 3);
};
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};

export function mountHeroScene(root: HTMLElement, stage: HTMLElement): () => void {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const labelsEl = q("[data-labels]")!;
  const scenesEl = Array.from(root.querySelectorAll<HTMLElement>("[data-scene]"));
  const barEl = q<HTMLElement>("[data-scene-bar]")!;
  const shippedEl = q<HTMLElement>("[data-shipped]")!;
  // `#t=` pins the camera time (used for screenshots); otherwise the loop runs.
  const pinned = (() => {
    const v = new URLSearchParams(location.hash.slice(1)).get("t");
    return v === null ? undefined : parseFloat(v);
  })();

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.fog = new THREE.FogExp2("#0b0b0c", 0.0009);

  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 6000);

  const floorMat = new THREE.MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.95, envMapIntensity: 0.15 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const key = new THREE.SpotLight("#ffffff", 4.2, 0, 0.5, 0.85, 1.2);
  key.position.set(0.25, 2.4, 1.3);
  key.target.position.set(0.05, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.radius = 4;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 6;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight("#ffffff", 0.9);
  rim.position.set(-2, 1.5, -2.5);
  scene.add(rim);
  const hemi = new THREE.HemisphereLight("#ffffff", "#222222", 0.12);
  scene.add(hemi);

  // ---------- machines on the table (shared modules, never copied) ----------
  const kit = makeKit();
  const MODELS = { a1mini, m02pro, instax } as const;
  type Slot = {
    model: keyof typeof MODELS | "fallback";
    size: [number, number, number];
    x: number;
    z?: number;
    name: string;
    id: string;
    verb: string;
    q: [number, number];
    wrap?: boolean;
    ghost?: boolean;
    centre?: THREE.Vector3;
    top?: THREE.Vector3;
    qNow?: number;
  };
  const SLOTS: Slot[] = [
    { model: "a1mini", size: [0.35, 0.37, 0.32], x: -0.34, z: -0.1, name: "bambu lab A1 mini", id: "m_fdm_01 · on site", verb: "printing keychain", q: [15.6, 4.4], wrap: true },
    { model: "m02pro", size: [0.09, 0.05, 0.08], x: 0.04, name: "phomemo M02 Pro", id: "m_sticker_01 · on site", verb: "printing sticker", q: [3.0, 1.3] },
    { model: "instax", size: [0.09, 0.12, 0.04], x: 0.2, name: "instax mini link 3", id: "m_photo_01 · on site", verb: "printing logo", q: [4.3, 1.6] },
  ];
  const machines: MachineModel[] = SLOTS.map((s) => {
    try {
      return MODELS[s.model as keyof typeof MODELS].build(THREE, kit);
    } catch (e) {
      console.warn("machine fallback", s.model, e);
      const group = new THREE.Group();
      const b = kit.rbox(s.size[0], s.size[1], s.size[2], 0.01, kit.mat.shell);
      b.position.y = s.size[1] / 2;
      group.add(b);
      return { group, update() {} };
    }
  });
  machines.forEach((m, i) => {
    const s = SLOTS[i];
    m.group.position.set(s.x, 0, s.z || 0);
    m.group.rotation.y = -0.12;
    scene.add(m.group);
    const box = new THREE.Box3().setFromObject(m.group);
    s.centre = box.getCenter(new THREE.Vector3());
    s.top = new THREE.Vector3(box.min.x + (box.max.x - box.min.x) * 0.15, box.max.y, box.max.z);
  });

  // "even more": dashed ghosts of other kinds of machine, cycling.
  const ghostMat = new THREE.LineDashedMaterial({ color: "#8E8E8A", dashSize: 0.008, gapSize: 0.006, transparent: true });
  const ghost = (parts: number[][]) => {
    const g = new THREE.Group();
    parts.forEach(([w, h, d, x, y, z]) => {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), ghostMat);
      e.position.set(x, y + h / 2, z);
      e.computeLineDistances();
      g.add(e);
    });
    return g;
  };
  const ghosts = [
    ghost([[0.26, 0.11, 0.18, 0, 0, 0], [0.22, 0.03, 0.15, 0, 0.11, 0]]),
    ghost([[0.26, 0.02, 0.1, 0, 0, 0], [0.04, 0.12, 0.05, 0.09, 0.02, 0], [0.22, 0.04, 0.05, 0, 0.14, 0], [0.04, 0.06, 0.04, -0.09, 0.08, 0]]),
    ghost([[0.28, 0.03, 0.2, 0, 0, 0], [0.02, 0.15, 0.02, -0.12, 0.03, 0], [0.02, 0.15, 0.02, 0.12, 0.03, 0], [0.26, 0.02, 0.03, 0, 0.16, 0], [0.04, 0.06, 0.04, 0, 0.11, 0]]),
  ];
  const ghostRoot = new THREE.Group();
  ghostRoot.position.set(0.47, 0, 0);
  ghostRoot.rotation.y = -0.2;
  ghosts.forEach((g) => ghostRoot.add(g));
  scene.add(ghostRoot);
  SLOTS.push({ model: "fallback", size: [0, 0, 0], x: 0, ghost: true, name: "even more", id: "laser · cnc · sewing · vinyl …", verb: "", q: [0, 0], top: new THREE.Vector3(0.36, 0.2, 0.1), centre: new THREE.Vector3(0.47, 0.08, 0) });

  // ---------- the Bay Area, at map scale (table at the origin) ----------
  const MAPW = 620, MAPD = 330, DEST: [number, number] = [0.185, 0.235];
  const toWorld = (u: number, v: number) => new THREE.Vector3((u - DEST[0]) * MAPW, 0, (v - DEST[1]) * MAPD);
  const COAST: Record<string, [number, number][]> = {
    marinCoast: [[0.06, 0], [0.09, 0.06], [0.1, 0.12], [0.11, 0.155]],
    sfCoast: [[0.115, 0.2], [0.12, 0.3], [0.125, 0.42], [0.14, 0.55], [0.13, 0.68], [0.15, 0.82], [0.16, 1]],
    marinBay: [[0.28, 0], [0.3, 0.08], [0.315, 0.165]],
    sfBay: [[0.315, 0.205], [0.3, 0.26], [0.31, 0.33], [0.35, 0.45], [0.4, 0.55], [0.47, 0.66], [0.55, 0.8], [0.6, 0.92], [0.62, 1]],
    eastBay: [[0.36, 0], [0.37, 0.1], [0.36, 0.2], [0.39, 0.32], [0.45, 0.43], [0.53, 0.55], [0.61, 0.68], [0.67, 0.8], [0.71, 0.9], [0.73, 1]],
  };
  const xAt = (seg: [number, number][], v: number) => {
    for (let i = 1; i < seg.length; i++)
      if (v <= seg[i][1]) {
        const a = seg[i - 1], b = seg[i];
        return lerp(a[0], b[0], (v - a[1]) / (b[1] - a[1] || 1));
      }
    return seg[seg.length - 1][0];
  };
  const isLand = (u: number, v: number) => {
    if (u > xAt(COAST.eastBay, v)) return true;
    if (v < 0.155) return u > xAt(COAST.marinCoast, v) && u < xAt(COAST.marinBay, v);
    if (v > 0.205) return u > xAt(COAST.sfCoast, v) && u < xAt(COAST.sfBay, v);
    return false;
  };

  const mapRoot = new THREE.Group();
  scene.add(mapRoot);
  const mapMats: { m: THREE.Material & { opacity: number }; base: number }[] = [];
  const fadeMat = <M extends THREE.Material>(m: M, base = 1): M => {
    m.transparent = true;
    m.depthWrite = false;
    mapMats.push({ m: m as THREE.Material & { opacity: number }, base });
    return m;
  };
  const PR = renderer.getPixelRatio();

  // Sprites keep a constant pixel size at any altitude, like markers on a map app.
  const spriteTex = (kind: "dot" | "ring" | "sq") => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = g.strokeStyle = "#fff";
    if (kind === "dot") {
      g.beginPath();
      g.arc(32, 32, 28, 0, Math.PI * 2);
      g.fill();
    }
    if (kind === "ring") {
      g.lineWidth = 9;
      g.beginPath();
      g.arc(32, 32, 24, 0, Math.PI * 2);
      g.stroke();
    }
    if (kind === "sq") g.fillRect(10, 10, 44, 44);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const TEX = { dot: spriteTex("dot"), ring: spriteTex("ring"), sq: spriteTex("sq") };
  const points = (positions: THREE.Vector3[], sizePx: number, color: string, tex: keyof typeof TEX, base = 1) => {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap((p) => [p.x, p.y, p.z]), 3));
    const m = fadeMat(new THREE.PointsMaterial({ size: sizePx * PR, sizeAttenuation: false, map: TEX[tex], color, alphaTest: 0.02, depthTest: false }), base);
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    mapRoot.add(pts);
    return pts;
  };

  const coastMat = fadeMat(new THREE.LineBasicMaterial({ color: "#5f5f5c" }));
  Object.values(COAST).forEach((seg) => {
    const g = new THREE.BufferGeometry().setFromPoints(seg.map(([u, v]) => toWorld(u, v).setY(0.05)));
    mapRoot.add(new THREE.Line(g, coastMat));
  });

  // land as a dot grid
  const landPts: THREE.Vector3[] = [];
  for (let u = 0; u <= 1; u += 0.0075) for (let v = 0; v <= 1; v += 0.012) if (isLand(u, v)) landPts.push(toWorld(u, v).setY(0.04));
  const land = points(landPts, 2.4, "#5a5a56", "dot");

  // the network: ~150 machines, clustered around towns
  const r = rng(7);
  const CL = [[0.21, 0.3, 0.03], [0.24, 0.55, 0.03], [0.19, 0.07, 0.02], [0.47, 0.15, 0.03], [0.5, 0.32, 0.04], [0.62, 0.52, 0.04], [0.74, 0.7, 0.04], [0.75, 0.22, 0.05], [0.86, 0.86, 0.04], [0.88, 0.12, 0.04], [0.83, 0.47, 0.04]];
  const net: THREE.Vector3[] = [];
  while (net.length < 150) {
    const c = CL[Math.floor(r() * CL.length)];
    const u = c[0] + (r() + r() + r() - 1.5) * c[2] * 1.5,
      v = c[1] + (r() + r() + r() - 1.5) * c[2] * 2.2;
    if (isLand(u, v)) net.push(toWorld(u, v).setY(0.08));
  }
  const netPts = points(net, 9, "#a5a5a0", "ring");

  // destinations: the table (gift) and a shelter (relief)
  const DESTS = [
    { at: new THREE.Vector3(0, 0.1, 0), label: "cal hacks · for henry", hot: true },
    { at: toWorld(0.53, 0.36).setY(0.1), label: "oakland shelter", hot: false },
  ];
  DESTS.forEach((d) => points([d.at], 11, d.hot ? "#FF5B1F" : "#F0F0EC", "dot"));
  const pulses = DESTS.map((d) => points([d.at], 12, d.hot ? "#FF5B1F" : "#F0F0EC", "ring"));

  // arcs: pixel-width lines that glow
  const HOT = new THREE.Color().setRGB(1.7, 0.36, 0.08),
    COOL = new THREE.Color().setRGB(1.1, 1.1, 1.08);
  const lineMats: LineMaterial[] = [];
  const lineMat = (color: THREE.Color, width: number, base: number) => {
    const m = fadeMat(new LineMaterial({ color, linewidth: width, worldUnits: false }), base);
    m.resolution.set(innerWidth, innerHeight);
    lineMats.push(m);
    return m;
  };
  const arcMatHot = lineMat(HOT, 2.2, 1),
    arcMat = lineMat(COOL, 1.2, 0.55);
  const arcCurve = (a: THREE.Vector3, b: THREE.Vector3, lift?: number) => {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const h = lift ?? a.distanceTo(b) * 0.2 + 6;
    return new THREE.CubicBezierCurve3(a.clone().setY(0.2), a.clone().lerp(mid, 0.5).setY(h), b.clone().lerp(mid, 0.5).setY(h), b.clone().setY(0.2));
  };
  const arcLine = (curve: THREE.CubicBezierCurve3, mat: LineMaterial, n = 90) => {
    const g = new LineGeometry();
    g.setPositions(curve.getPoints(n).flatMap((p) => [p.x, p.y, p.z]));
    const l = new Line2(g, mat);
    l.computeLineDistances();
    l.frustumCulled = false;
    mapRoot.add(l);
    return { line: l, geo: g, segs: n };
  };
  type Arc = ReturnType<typeof arcLine> & { curve: THREE.CubicBezierCurve3; pkg: THREE.Points; start: number };
  const arcs: Arc[] = [];
  for (let i = 0; i < 18; i++) {
    const src = net[Math.floor(r() * net.length)],
      d = DESTS[i % 3 === 0 ? 1 : 0];
    const curve = arcCurve(src, d.at);
    const a = arcLine(curve, d.hot ? arcMatHot : arcMat);
    a.geo.instanceCount = 0;
    const pkg = points([new THREE.Vector3()], 6, "#ffffff", "sq");
    arcs.push({ ...a, curve, pkg, start: 10.0 + i * 0.17 });
  }
  const orderCurve = arcCurve(toWorld(1.9, -0.6), DESTS[0].at, 200);
  const order = arcLine(orderCurve, arcMatHot, 160);
  order.geo.instanceCount = 0;
  const env = points([new THREE.Vector3()], 10, "#FF5B1F", "sq");
  const setPoint = (pts: THREE.Points, p: THREE.Vector3) => {
    pts.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
    pts.geometry.attributes.position.needsUpdate = true;
  };

  // labels live in the overlay
  const machineLabels = SLOTS.map((s) => {
    const d = document.createElement("div");
    d.className = "hm-lab";
    d.innerHTML = `<b>${s.name}</b><span>${s.id}</span><em></em>`;
    labelsEl.appendChild(d);
    return d;
  });
  const kcLabel = document.createElement("div");
  kcLabel.className = "hm-lab";
  kcLabel.innerHTML = "<b>keychain · for henry</b><span>pla · 30 layers · 0.2 mm</span><em>printed here · done</em>";
  labelsEl.appendChild(kcLabel);
  const CITIES: [string, number, number][] = [["san francisco", 0.165, 0.37], ["berkeley", 0.44, 0.1], ["oakland", 0.52, 0.27], ["hayward", 0.63, 0.46], ["san mateo", 0.22, 0.63], ["walnut creek", 0.76, 0.18]];
  const cityLabels = CITIES.map(([n, u, v]) => {
    const d = document.createElement("div");
    d.className = "hm-city";
    d.textContent = n;
    labelsEl.appendChild(d);
    return { d, p: toWorld(u, v) };
  }).concat(
    DESTS.map((dd) => {
      const d = document.createElement("div");
      d.className = "hm-city" + (dd.hot ? " hot" : "");
      d.textContent = dd.label;
      labelsEl.appendChild(d);
      return { d, p: dd.at.clone().setY(14) };
    }),
  );
  const orderLabel = document.createElement("div");
  orderLabel.className = "hm-city hot";
  orderLabel.textContent = "new order · from austin, tx";
  labelsEl.appendChild(orderLabel);

  // ---------- camera timeline ----------
  // [time, target, distance (m), azimuth (deg), elevation (deg), target easing]
  type Target = () => THREE.Vector3;
  const A1: Target = () => SLOTS[0].centre!.clone().add(new THREE.Vector3(0, -0.035, 0));
  const M2: Target = () => SLOTS[1].centre!.clone().add(new THREE.Vector3(0, 0.025, 0.01));
  const IX: Target = () => SLOTS[2].centre!.clone().add(new THREE.Vector3(0, 0.08, 0));
  const ALL: Target = () => new THREE.Vector3(0.04, 0.25, 0);
  // the finished keychain on the A1's bed (bed-local position, metres)
  const KC_LOCAL = new THREE.Vector3(-0.035, 0.09, 0.004);
  const KC: Target = () => machines[0].group.localToWorld(KC_LOCAL.clone());
  const MAPC: Target = () => toWorld(0.42, 0.42),
    MAPC2: Target = () => toWorld(0.36, 0.38);
  type Key = [number, Target, number, number, number, "inout" | "dist" | "in" | "out"];
  const CAM: Key[] = [
    [0, A1, 1.42, 26, 12, "inout"], [1.6, A1, 1.34, 36, 14, "inout"],
    [2.15, KC, 0.24, -14, 40, "inout"], [2.85, KC, 0.21, 12, 44, "inout"],
    [3.3, M2, 0.44, -22, 20, "inout"], [4.2, M2, 0.4, -8, 22, "inout"],
    [4.7, IX, 0.6, -12, 12, "inout"], [5.8, IX, 0.56, 6, 14, "inout"],
    [7.0, ALL, 2.1, 16, 15, "inout"],
    [9.6, MAPC, 560, 4, 56, "dist"],
    [15.0, MAPC2, 500, 30, 50, "inout"],
    [T, A1, 1.42, 26, 12, "dist"],
  ];
  const ez = { inout: ease, in: easeIn, out: easeOut, dist: ease };
  const cameraAt = (t: number) => {
    let k = 0;
    while (k < CAM.length - 2 && t >= CAM[k + 1][0]) k++;
    const a = CAM[k], b = CAM[k + 1];
    const u = (t - a[0]) / (b[0] - a[0]);
    const ta = a[1](), tb = b[1]();
    let dist = Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), ease(u)));
    // on a tall phone screen the keychain close-up would overflow the narrow width, so pull back for very close shots
    dist *= 1 + (Math.max(1, 1.25 / camera.aspect) - 1) * clamp((0.35 - dist) / 0.1);
    // 'dist': the target moves with how far the camera is, so the table stays in frame while we rise or dive.
    const w = b[5] === "dist" ? clamp((dist - a[2]) / (b[2] - a[2])) : ez[b[5]](u);
    const target = ta.clone().lerp(tb, w);
    const az = THREE.MathUtils.degToRad(lerp(a[3], b[3], ease(u)));
    const el = THREE.MathUtils.degToRad(lerp(a[4], b[4], ease(u)));
    return { target, dist, az, el };
  };

  // ---------- post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.12, 0.4, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // dark studio only (the light theme of the reference is not part of the demo)
  scene.background = new THREE.Color("#0b0b0c");
  scene.fog!.color.set("#0b0b0c");
  coastMat.color.set("#5f5f5c");
  arcMat.color.copy(COOL);
  netPts.material.color.set("#a5a5a0");
  land.material.color.set("#5a5a56");

  const v3 = new THREE.Vector3();
  const project = (p: THREE.Vector3) => {
    v3.copy(p).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight, on: v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 };
  };

  const update = (t: number) => {
    const c = cameraAt(t);
    camera.position.set(
      c.target.x + c.dist * Math.cos(c.el) * Math.sin(c.az),
      c.target.y + c.dist * Math.sin(c.el),
      c.target.z + c.dist * Math.cos(c.el) * Math.cos(c.az),
    );
    // keep subjects above the headline: look slightly below them while we are at the table
    camera.lookAt(c.target.clone().add(new THREE.Vector3(0, -0.075 * c.dist * (1 - clamp((c.dist - 2) / 6)), 0)));
    camera.near = Math.max(0.005, c.dist * 0.01);
    camera.far = Math.max(50, c.dist * 12);
    camera.updateProjectionMatrix();

    // how far up we are: 0 at the table, 1 at map height
    const alt = clamp((Math.log(c.dist) - Math.log(3)) / (Math.log(90) - Math.log(3)));
    mapMats.forEach(({ m, base }) => {
      m.opacity = base * alt;
    });
    mapRoot.visible = alt > 0.001;
    key.intensity = 4.2 * (1 - alt * 0.6);
    bloom.strength = 0.12 + alt * 0.5;

    machines.forEach((m, i) => {
      const s = SLOTS[i];
      // wrap: the job starts during the dive back and carries across the loop seam, so the A1 is mid-print at t = 0.
      const progress = s.wrap ? clamp((((t - s.q[0]) % T) + T) % T / s.q[1]) : t < 15 ? clamp((t - s.q[0]) / s.q[1]) : 0;
      m.update(progress, t);
      s.qNow = progress;
    });
    const gi = t / 1.4,
      cur = Math.floor(gi) % ghosts.length,
      fr = gi - Math.floor(gi);
    ghosts.forEach((g, j) => {
      g.visible = j === cur || (fr > 0.75 && j === (cur + 1) % ghosts.length);
    });

    // order flies in, then deliveries
    const oc = ease(clamp((t - 9.0) / 1.4));
    order.geo.instanceCount = Math.floor(order.segs * oc);
    order.line.visible = t >= 9.0 && t < 14.6;
    env.visible = t >= 9.0 && oc < 1;
    setPoint(env, orderCurve.getPoint(oc));
    let delivered = 0;
    arcs.forEach((a) => {
      const d = ease(clamp((t - a.start) / 1.1)),
        f = clamp((t - a.start - 0.5) / 2.2);
      a.geo.instanceCount = Math.floor(a.segs * d);
      a.line.visible = t >= a.start && t < 14.8;
      a.pkg.visible = f > 0 && f < 1 && t < 14.8;
      if (a.pkg.visible) setPoint(a.pkg, a.curve.getPoint(ease(f)));
      if (f >= 1 && t < 15) delivered++;
    });
    pulses.forEach((p, i) => {
      const k = (t * 0.6 + i * 0.5) % 1;
      p.material.size = (12 + k * 44) * PR;
      p.material.opacity = (1 - k) * alt;
    });
    if (shippedEl) shippedEl.textContent = (1284 + delivered).toLocaleString("en-US");

    // overlay labels
    const near = 1 - clamp((c.dist - 1.2) / 1.2);
    SLOTS.forEach((s, i) => {
      const el = machineLabels[i],
        pr = project(s.top!);
      const focus = c.target.distanceTo(s.centre!) < 0.05 ? 1 : 0.55;
      el.style.left = pr.x + "px";
      el.style.top = Math.max(150, pr.y - 18) + "px";
      el.style.opacity = String(pr.on ? near * focus : 0);
      const em = el.querySelector("em");
      if (em) em.textContent = s.ghost ? "+147 more nearby" : (s.qNow ?? 0) >= 1 ? "done!" : (s.qNow ?? 0) <= 0 ? "queued" : `${s.verb} ${Math.round((s.qNow ?? 0) * 100)}%`;
    });
    {
      const k = KC(),
        pr = project(k.setY(k.y + 0.02)),
        show = clamp((t - 1.95) / 0.2) * clamp((3.15 - t) / 0.2);
      kcLabel.style.left = pr.x + "px";
      kcLabel.style.top = pr.y - 18 + "px";
      kcLabel.style.opacity = String(pr.on ? show : 0);
    }
    cityLabels.forEach(({ d, p }) => {
      const pr = project(p);
      d.style.left = pr.x + "px";
      d.style.top = pr.y + "px";
      d.style.opacity = String(pr.on ? alt : 0);
    });
    {
      const pr = project(orderCurve.getPoint(Math.max(0.12, oc * 0.5)));
      orderLabel.style.left = pr.x + "px";
      orderLabel.style.top = pr.y - 16 + "px";
      orderLabel.style.opacity = String(pr.on && t >= 9.0 && t < 13.8 ? alt : 0);
    }

    const sc = t < 7 ? 0 : t < 9.6 ? 1 : t < 15 ? 2 : 0;
    const span = t < 7 ? [0, 7] : t < 9.6 ? [7, 9.6] : t < 15 ? [9.6, 15] : [15, 15];
    scenesEl.forEach((e, i) => e.classList.toggle("on", i === sc));
    const on = scenesEl[sc];
    if (on && barEl) {
      barEl.style.left = on.offsetLeft + "px";
      barEl.style.width = span[1] > span[0] ? on.offsetWidth * clamp((t - span[0]) / (span[1] - span[0])) + "px" : "0px";
    }
  };

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    lineMats.forEach((m) => m.resolution.set(innerWidth, innerHeight));
  };
  addEventListener("resize", resize);
  camera.aspect = innerWidth / innerHeight;

  // Reduced motion: one still frame, no loop.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = performance.now();
  let raf = 0;
  let alive = true;
  const frame = (now: number) => {
    if (!alive) return;
    const t = pinned !== undefined && !Number.isNaN(pinned) ? pinned : reduce ? 6.5 : ((now - start) / 1000) % T;
    update(t);
    composer.render();
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      mats.forEach((m) => {
        const tex = (m as THREE.MeshStandardMaterial).map;
        tex?.dispose();
        m.dispose();
      });
    });
    Object.values(TEX).forEach((t) => t.dispose());
    lineMats.forEach((m) => m.dispose());
    envTex.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    labelsEl.replaceChildren();
  };
}
