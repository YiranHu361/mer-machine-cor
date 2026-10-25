// A machine on a spotlit turntable, built from the shared 3D models. The thing
// being made stays in the centre of the card: `progress` (0..1) drives the model.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeKit } from "../shared/three/kit.js";
import * as a1mini from "../shared/three/machines/a1mini.js";
import * as m02pro from "../shared/three/machines/m02pro.js";
import * as instax from "../shared/three/machines/instax.js";
import type { MachineModel } from "../shared/three/machines/machine";

const BUILDERS: Record<string, { build: (t: typeof THREE, k: ReturnType<typeof makeKit>) => MachineModel }> = {
  a1mini,
  m02pro,
  instax,
};

/** The shared model that matches a machine's model name; a plain case when none does. */
export function modelKeyFor(model: string): keyof typeof BUILDERS | "generic" {
  if (/a1|bambu/i.test(model)) return "a1mini";
  if (/m02|phomemo/i.test(model)) return "m02pro";
  if (/instax|link/i.test(model)) return "instax";
  return "generic";
}

export function MachineViewport({ model, progress, label }: { model: string; progress: number; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", label);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0b0c");
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.95, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const spot = new THREE.SpotLight("#ffffff", 3.2, 0, 0.32, 0.9, 1.6);
    spot.position.set(0.05, 1.6, 0.6);
    spot.target.position.set(0, 0.05, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
    spot.shadow.radius = 4;
    scene.add(spot, spot.target);
    const rim = new THREE.DirectionalLight("#ffffff", 0.5);
    rim.position.set(-1, 0.8, -1.2);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight("#ffffff", "#222222", 0.1));

    // Build the machine; fall back to a plain housing if the model cannot be built.
    const kit = makeKit();
    const key = modelKeyFor(model);
    let machine: MachineModel;
    try {
      machine = key === "generic" ? genericModel(kit) : BUILDERS[key].build(THREE, kit);
    } catch (error) {
      console.warn("machine view fallback", error);
      machine = genericModel(kit);
    }
    const turntable = new THREE.Group();
    turntable.add(machine.group);
    scene.add(turntable);
    const box = new THREE.Box3().setFromObject(machine.group);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    // Centre the model on the turntable axis and fit it to the card so a tall
    // machine (the A1's arm) reads as large as a small box printer.
    machine.group.position.x -= centre.x;
    machine.group.position.z -= centre.z;
    const target = new THREE.Vector3(0, size.y * 0.48, 0);
    // Half extents the camera must see while the model turns.
    const halfW = Math.max(Math.hypot(size.x, size.z) / 2, 0.05);
    const halfH = Math.max(size.y / 2, 0.05);
    const view = new THREE.Vector3(0.52, 0.34, 0.78).normalize();
    // The A1's box includes the cable loop and the open arm, so it can sit closer;
    // the instax needs headroom for the photo it pushes out of the top.
    const zoom = key === "a1mini" ? 0.8 : key === "instax" ? 1.15 : 1;
    const fit = () => {
      const v = THREE.MathUtils.degToRad(camera.fov) / 2;
      const h = Math.atan(Math.tan(v) * camera.aspect);
      const dist = (Math.max((halfH * 1.15) / Math.tan(v), halfW / Math.tan(h)) * 1.3 + halfW * 0.7) * zoom;
      camera.position.copy(target).addScaledVector(view, dist);
      camera.lookAt(target);
    };

    const resize = () => {
      const w = Math.max(1, host.clientWidth),
        h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const start = performance.now();
    let raf = 0;
    let alive = true;
    const frame = (now: number) => {
      if (!alive) return;
      const t = (now - start) / 1000;
      turntable.rotation.y = reduce ? -0.35 : -0.35 + t * 0.18;
      machine.update(progressRef.current, t);
      renderer.render(scene, camera);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    if (reduce) renderer.render(scene, camera);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        mats.forEach((m) => m.dispose());
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [model, label]);

  return <div className="sl-viewport" ref={hostRef} />;
}

/** A plain housing for machines without a model. */
function genericModel(kit: ReturnType<typeof makeKit>): MachineModel {
  const group = new THREE.Group();
  const body = kit.rbox(0.3, 0.2, 0.26, 0.012, kit.mat.shell);
  body.position.y = 0.1;
  group.add(body);
  const panel = kit.rbox(0.2, 0.05, 0.01, 0.004, kit.mat.dark);
  panel.position.set(0, 0.15, 0.135);
  group.add(panel);
  return { group, update() {} };
}
