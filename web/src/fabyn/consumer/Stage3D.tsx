import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeKit } from "../shared/three/kit.js";
import * as a1mini from "../shared/three/machines/a1mini.js";
import * as m02pro from "../shared/three/machines/m02pro.js";
import * as instax from "../shared/three/machines/instax.js";
import type { MachineKind } from "./model";

/* One three.js stage: a real machine model with the thing being made in the
   centre. Used by every wait, making and ready screen. The print is shown as a
   sweep that reveals the item; progress comes from the caller (estimate.ts). */

export type StageItem =
  /** sizeMm: the prepared model's real size [width, height, thickness]; text keeps its case */
  | { kind: "keychain"; text: string; sizeMm?: number[] }
  | { kind: "sticker"; imageUrl?: string; text?: string }
  | { kind: "photo"; imageUrl?: string; text?: string };

export interface Stage3DProps {
  machine: MachineKind | null;
  item: StageItem | null;
  /** 0..1 print progress; null means no print, the item is shown whole */
  progress: number | null;
  /** sweep the print on its own, for wait screens */
  loop?: boolean;
  /** draw the toolpath over the item while it is being made */
  toolpath?: boolean;
  /** the machine stays parked and the item whole; only the toolpath runs over it (a file being prepared) */
  parked?: boolean;
  /** frame the item itself, large and centred, with the machine as context */
  focus?: boolean;
  label: string;
  className?: string;
}

const MODELS = { a1mini, m02pro, instax } as const;
const kit = makeKit();
const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
// focused camera distance (per metre of item size) and elevation: the item fills about half the frame,
// with the bed and the toolhead around it as context
const FOCUS_PER_M = 3.8;
const FOCUS_EL = 34;
// while the A1 mini's head is down over the item, look in lower and from nearly straight ahead
const FOCUS_EL_HEAD_DOWN = 24;
const FOCUS_AZ_A1 = 18;

// camera framing per machine: target (m), distance (m), azimuth and elevation (deg)
const FRAME: Record<string, { target: [number, number, number]; dist: number; az: number; el: number }> = {
  a1mini: { target: [-0.03, 0.15, 0.0], dist: 0.8, az: 30, el: 20 },
  m02pro: { target: [0, 0.03, 0.07], dist: 0.34, az: 26, el: 30 },
  instax: { target: [0, 0.04, 0.07], dist: 0.42, az: 24, el: 26 },
  none: { target: [0, 0.01, 0], dist: 0.2, az: 22, el: 32 },
};
// where the finished item sits on each machine (metres, machine-local)
const ITEM_AT: Record<string, [number, number, number]> = {
  a1mini: [-0.035, 0.09, 0.004],
  m02pro: [0, 0.001, 0.085],
  instax: [0, 0.001, 0.09],
  none: [0, 0, 0],
};

function canvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 512) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function textTexture(text: string, bg: string, fg: string, w = 512, h = 512, upper = true) {
  return canvasTexture(
    (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      let size = Math.floor(h * 0.5);
      const label = (upper ? (text || "").toUpperCase() : text || "").slice(0, 24);
      do {
        g.font = `600 ${size}px Archivo, Helvetica, Arial, sans-serif`;
        size -= 4;
      } while (g.measureText(label).width > w * 0.84 && size > 20);
      g.fillText(label, w / 2, h / 2);
    },
    w,
    h,
  );
}

interface BuiltItem {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  texs: THREE.Texture[];
  width: number;
  depth: number;
  top: number;
  toolpath: THREE.Line | null;
}

/** Items are real metres: a 74 mm keychain, a 48 mm sticker, an instax photo. */
function buildItem(item: StageItem, withToolpath: boolean, onTexture: () => void): BuiltItem {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];
  const add = (mesh: THREE.Mesh, flatY: number) => {
    mesh.position.y = flatY;
    group.add(mesh);
    return mesh;
  };
  const plane = (w: number, h: number, mat: THREE.Material) => {
    const g = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    geos.push(g);
    mats.push(mat);
    return new THREE.Mesh(g, mat);
  };
  const loadTex = (url: string) => {
    const t = new THREE.TextureLoader().load(url, () => onTexture());
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texs.push(t);
    return t;
  };
  let width = 0.05;
  let depth = 0.05;
  let top = 0.001;
  if (item.kind === "keychain") {
    const [wm, hm, tm] = item.sizeMm?.length === 3 && item.sizeMm.every((n) => n > 0 && n < 300) ? item.sizeMm : [74, 26, 3];
    const w = wm / 1000, h = hm / 1000, t = tm / 1000, r = Math.min(0.006, h / 4);
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const hole = new THREE.Path();
    hole.absarc(-w / 2 + Math.max(0.0055, h * 0.3), 0, Math.min(0.0035, h * 0.18), 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateX(-Math.PI / 2);
    geos.push(g);
    const body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#FF5B1F", roughness: 0.4, metalness: 0, envMapIntensity: 0.6 }));
    mats.push(body.material as THREE.Material);
    group.add(body);
    const txt = textTexture(item.text, "rgba(0,0,0,0)", "#0b0b0c", 1024, 360, false);
    txt.anisotropy = 4;
    // the text sits right of the keyring hole
    const holeRoom = Math.max(0.0055, h * 0.3) + Math.min(0.0035, h * 0.18);
    const label = plane((w - holeRoom * 1.6) * 0.92, h * 0.62, new THREE.MeshStandardMaterial({ map: txt, transparent: true, alphaTest: 0.04, roughness: 0.6 }));
    label.position.x = holeRoom * 0.8;
    label.position.y = t + 0.0002;
    group.add(label);
    texs.push(txt);
    width = w;
    depth = h;
    top = t + 0.0002;
  } else if (item.kind === "sticker") {
    const size = 0.048;
    const frame = plane(size * 1.07, size * 1.07, new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.8 }));
    add(frame, 0.0005);
    const map = item.imageUrl ? loadTex(item.imageUrl) : textTexture(item.text || "sticker", "#f4f4f0", "#0b0b0c");
    if (!item.imageUrl) texs.push(map);
    const face = plane(size, size, new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
    add(face, 0.0012);
    width = size;
    depth = size;
    top = 0.0012;
  } else {
    const frame = plane(0.086, 0.104, new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.85 }));
    add(frame, 0.0005);
    const map = item.imageUrl ? loadTex(item.imageUrl) : textTexture(item.text || "photo", "#d9d6cf", "#0b0b0c");
    if (!item.imageUrl) texs.push(map);
    const face = plane(0.072, 0.072, new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
    face.position.z = -0.008;
    face.position.y = 0.0012;
    group.add(face);
    mats.push(face.material as THREE.Material);
    width = 0.086;
    depth = 0.104;
    top = 0.0012;
  }
  // toolpath: a zig-zag over the item, grown by drawRange
  let toolpath: THREE.Line | null = null;
  if (withToolpath) {
    const rows = 7;
    const pts: number[] = [];
    for (let i = 0; i < rows; i++) {
      const z = -depth * 0.38 + (depth * 0.76 * i) / (rows - 1);
      const x0 = -width * 0.42, x1 = width * 0.42;
      const [a, b] = i % 2 ? [x1, x0] : [x0, x1];
      pts.push(a, top + 0.0045, z, b, top + 0.0045, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({ color: "#FF5B1F", transparent: true, opacity: 0.9 });
    geos.push(g);
    mats.push(m);
    toolpath = new THREE.Line(g, m);
    group.add(toolpath);
  }
  return { group, mats, geos, texs, width, depth, top, toolpath };
}

export function Stage3D({
  machine,
  item,
  progress,
  loop = false,
  toolpath = false,
  parked = false,
  focus = false,
  label,
  className,
}: Stage3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef({ progress, loop, focus, parked, dirty: true, visible: true });
  const [failed, setFailed] = useState(false);
  const itemKey = item
    ? [
        item.kind,
        "text" in item ? item.text ?? "" : "",
        "imageUrl" in item ? item.imageUrl ?? "" : "",
        "sizeMm" in item ? (item.sizeMm ?? []).join("x") : "",
      ].join("|")
    : "none";

  useEffect(() => {
    live.current.progress = progress;
    live.current.loop = loop;
    live.current.parked = parked;
    live.current.focus = focus;
    live.current.dirty = true;
  }, [progress, loop, focus, parked]);

  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    const canvas = renderer.domElement;
    canvas.className = "stage3d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0b0c");
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.95, envMapIntensity: 0.15 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const key = new THREE.SpotLight("#ffffff", 0.9, 0, 0.5, 0.9, 2);
    key.position.set(0.05, 0.6, 0.35);
    key.target.position.set(0, 0, 0.03);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    key.shadow.camera.near = 0.05;
    key.shadow.camera.far = 3;
    scene.add(key, key.target);
    scene.add(new THREE.DirectionalLight("#ffffff", 0.25).translateX(-0.4).translateY(0.5).translateZ(-0.6));
    scene.add(new THREE.HemisphereLight("#ffffff", "#222222", 0.08));

    const disposers: (() => void)[] = [];
    let model: ReturnType<(typeof MODELS)[keyof typeof MODELS]["build"]> | null = null;
    let built: BuiltItem | null = null;
    const current = item;
    const machineKey = machine ?? "none";
    if (machine) {
      model = MODELS[machine].build(THREE, kit);
      scene.add(model.group);
      model.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      // the printer's own sample tag is replaced by the item that carries the name
      if (model.tag && current) model.tag.visible = false;
    }
    if (current) {
      built = buildItem(current, toolpath, () => {
        live.current.dirty = true;
      });
      if (model?.bed && model.tag) {
        // on the A1 mini the item rides the moving bed (millimetre space), where the sample tag sat
        const anchor = new THREE.Group();
        anchor.position.copy(model.tag.position);
        anchor.scale.setScalar(1000);
        model.bed.add(anchor);
        anchor.add(built.group);
      } else {
        const at = ITEM_AT[machineKey];
        built.group.position.set(at[0], at[1], at[2]);
        if (model) model.group.add(built.group);
        else scene.add(built.group);
      }
      built.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
    }

    // reveal plane, in world space: keeps x <= xr while printing
    const reveal = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    const nozzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.0038, 16, 12),
      new THREE.MeshStandardMaterial({ color: "#FF5B1F", emissive: "#FF5B1F", emissiveIntensity: 1.2 }),
    );
    nozzle.visible = false;
    scene.add(nozzle);
    disposers.push(() => nozzle.geometry.dispose());

    const cfg = FRAME[machineKey];
    const itemWorld = new THREE.Vector3();
    const frame = (t: number) => {
      const L = live.current;
      const p = L.loop ? (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.5 : (t % 6) / 6) : L.progress;
      // camera: the machine as a whole, or close on the item when focused
      const fit = Math.max(1, 0.85 / camera.aspect);
      const az = ((built && L.focus && machineKey === "a1mini" && !L.parked ? FOCUS_AZ_A1 : cfg.az) + 5 * Math.sin(t * 0.3)) * DEG;
      // while the A1 mini's toolhead is down over the item, look in lower so the head does not hide it
      const headDown = machineKey === "a1mini" && !L.parked && (L.loop || (p !== null && p !== undefined && p > 0 && p < 1));
      const el = (built && L.focus ? (headDown ? FOCUS_EL_HEAD_DOWN : FOCUS_EL) : cfg.el) * DEG;
      let tx = cfg.target[0], ty = cfg.target[1], tz = cfg.target[2];
      let dist = cfg.dist * fit;
      if (built && L.focus) {
        built.group.getWorldPosition(itemWorld);
        tx = itemWorld.x;
        ty = itemWorld.y + 0.01;
        tz = itemWorld.z;
        // closer for a small sticker, further for an instax print
        dist = clamp(Math.max(built.width, built.depth) * FOCUS_PER_M, 0.17, 0.4) * fit;
      }
      camera.position.set(tx + dist * Math.cos(el) * Math.sin(az), ty + dist * Math.sin(el), tz + dist * Math.cos(el) * Math.cos(az));
      camera.lookAt(tx, ty, tz);
      // on the A1 mini the nozzle follows the print edge, so the printed part shows beside the head
      const printing = !L.parked && p !== null && p !== undefined && p > 0 && p < 1;
      const headX = built && model?.tag && printing ? model.tag.position.x + (built.width * (clamp(p, 0, 1) - 0.5)) * 1000 : undefined;
      model?.update(L.parked ? 0 : (p ?? 0), t, headX === undefined ? undefined : { headX });
      if (built) {
        built.group.getWorldPosition(itemWorld);
        const left = itemWorld.x - built.width / 2;
        if (L.parked && built.toolpath && p !== null && p !== undefined) {
          built.mats.forEach((m) => (m.clippingPlanes = null));
          const n = built.toolpath.geometry.getAttribute("position").count;
          built.toolpath.geometry.setDrawRange(0, Math.floor(n * clamp(p, 0, 1)));
          nozzle.visible = false;
        } else if (p === null || p >= 1 || p === undefined) {
          built.mats.forEach((m) => (m.clippingPlanes = null));
          if (built.toolpath) built.toolpath.geometry.setDrawRange(0, Infinity);
          nozzle.visible = false;
        } else {
          const xr = left + built.width * clamp(p, 0, 1);
          reveal.constant = xr;
          built.mats.forEach((m) => (m.clippingPlanes = [reveal]));
          nozzle.visible = p > 0.001;
          nozzle.position.set(xr, itemWorld.y + built.top + 0.0045, itemWorld.z);
          if (built.toolpath) {
            const n = built.toolpath.geometry.getAttribute("position").count;
            built.toolpath.geometry.setDrawRange(0, Math.floor(n * clamp(p, 0, 1)));
          }
        }
      }
      renderer.render(scene, camera);
    };

    let raf = 0;
    let visible = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const L = live.current;
      if (!visible) return;
      if (reduce && !L.dirty) return;
      L.dirty = false;
      frame((performance.now() - started) / 1000);
    };
    const size = () => {
      const w = host.clientWidth || 300;
      const h = host.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      live.current.dirty = true;
    };
    const ro = new ResizeObserver(size);
    ro.observe(host);
    size();
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      live.current.dirty = true;
    });
    io.observe(host);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
        }
      });
      built?.geos.forEach((g) => g.dispose());
      built?.mats.forEach((m) => m.dispose());
      built?.texs.forEach((t) => t.dispose());
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      envTex.dispose();
      disposers.forEach((d) => d());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // the scene is rebuilt when the machine or the item changes; progress is read live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, itemKey, toolpath]);

  if (failed)
    return (
      <div className={`stage3d stage3d-fallback ${className ?? ""}`} role="img" aria-label={label}>
        <span>{item && "text" in item && item.text ? item.text : label}</span>
      </div>
    );
  return <div ref={wrap} className={`stage3d ${className ?? ""}`} role="img" aria-label={label} />;
}
