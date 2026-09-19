import { useI18n } from "../i18n/I18n";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import vmr from "../simulator/vmr.json";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  AORTA,
  ARTERIAL_BRANCHES,
  CORONARIES,
  ACCESS_POINTS,
  curve,
  polyline,
  catheterPoints,
  catheterDisplayTip,
  wireShape,
  coronaryTube,
} from "../simulator/anatomy";
import {
  contrastField,
  defaultImaging,
  fluoroMagnification,
} from "../simulator/imaging";
import type {
  ImagingSettings,
  CapturedFrame,
  Cine,
} from "../simulator/imaging";
import { rootManeuver, ROOT } from "../simulator/model";
import type { SimulationState, Vec3 } from "../simulator/model";
export type ViewMode = "heart" | "route" | "root";
export type Projection = "AP" | "LAO" | "RAO";
interface Props {
  state: SimulationState;
  view: ViewMode;
  projection: Projection;
  heartVisible: boolean;
  fluoro?: boolean;
  visible?: boolean;
  resetKey?: number;
  imaging?: ImagingSettings;
  onCapture?: (frame: CapturedFrame) => void;
  onCine?: (cine: Cine) => void;
  onSnapshotReady?: (capture: (() => CapturedFrame | null) | null) => void;
}
function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
      c.geometry.dispose();
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      ms.forEach((m) => m.dispose());
    }
  });
}
function label(text: string, position: Vec3, color = "#3d5865", scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = "500 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 192, 48);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.position.set(...position);
  sprite.scale.set(2.1 * scale, 0.44 * scale, 1);
  sprite.userData.texture = texture;
  sprite.userData.setText = (value: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillText(value, 192, 48);
    texture.needsUpdate = true;
  };
  return sprite;
}
export function AnatomyView({
  state,
  view,
  projection,
  heartVisible,
  fluoro = false,
  visible = true,
  resetKey = 0,
  imaging = defaultImaging,
  onCapture,
  onCine,
  onSnapshotReady,
}: Props) {
  const { t, locale } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const [failed, setFailed] = useState(false);
  const [modelState, setModelState] = useState("loading");
  const api = useRef<{
    update: (s: SimulationState) => void;
    setView: () => void;
    invalidate: () => void;
    setLanguage: () => void;
  } | null>(null);
  const options = useRef({
    t,
    visible,
    view,
    projection,
    heartVisible,
    imaging,
    onCapture,
    onCine,
    onSnapshotReady,
  });
  options.current = {
    t,
    visible,
    view,
    projection,
    heartVisible,
    imaging,
    onCapture,
    onCine,
    onSnapshotReady,
  };
  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: fluoro,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(fluoro ? 0x192630 : 0xeef4f7, fluoro ? 1 : 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.current.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      fluoro
        ? t("同じ3D血管から計算した模式透視")
        : t("心臓とカテーテルの3Dモデル"),
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    let drawDirty = true;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener("change", () => {
      drawDirty = true;
    });
    controls.enableDamping = true;
    controls.enablePan = !fluoro;
    controls.enabled = !fluoro;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    scene.add(new THREE.HemisphereLight(0xf2faff, 0x98838e, 2.7));
    const key = new THREE.DirectionalLight(0xffffff, 3.3);
    key.position.set(-4, 7, 8);
    scene.add(key);
    const back = new THREE.DirectionalLight(0x9fdcd9, 2);
    back.position.set(5, 1, -4);
    scene.add(back);
    const anatomy = new THREE.Group();
    const devices = new THREE.Group();
    const annotations = new THREE.Group();
    scene.add(anatomy, devices, annotations);
    const archPoints = AORTA.slice(vmr.aorta.length - 1);
    const vessel = coronaryTube(
      {
        name: "aortic continuation",
        side: "LCA",
        points: archPoints,
        radius: 0.58,
        radii: archPoints.map(
          (_, i) => 0.58 - (0.29 * i) / (archPoints.length - 1),
        ),
        delay: 0,
      },
      fluoro ? 0x3b515d : 0xb96269,
      fluoro ? 0.25 : 0.2,
    );
    anatomy.add(vessel);
    let disposed = false;
    const sourceModel = new THREE.Group();
    anatomy.add(sourceModel);
    new GLTFLoader().load(
      new URL(
        `${import.meta.env.BASE_URL}models/vmr-coronary.glb`,
        document.baseURI,
      ).href,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const old = Array.isArray(o.material) ? o.material : [o.material];
            old.forEach((m) => m.dispose());
            o.material = new THREE.MeshStandardMaterial({
              color: fluoro ? 0x617985 : 0xad505c,
              transparent: true,
              opacity: fluoro ? 0.09 : 0.28,
              depthWrite: false,
              side: THREE.DoubleSide,
              forceSinglePass: true,
              roughness: 0.52,
            });
          }
        });
        drawDirty = true;
        sourceModel.add(gltf.scene);
        setModelState("ready");
      },
      undefined,
      () => {
        if (!disposed) setModelState("error");
      },
    );
    for (const branch of ARTERIAL_BRANCHES)
      anatomy.add(
        polyline(
          curve(branch.points).getPoints(50),
          branch.radius,
          fluoro ? 0x3b515d : 0xad707c,
          fluoro ? 0.2 : 0.3,
        ),
      );
    const heart = new THREE.Group();
    if (!fluoro) {
      // Synthetic surface, shaped for spatial learning; not a patient-derived anatomical mesh.
      const geometry = new THREE.SphereGeometry(1, 72, 56);
      const positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i),
          taper = 0.7 + (0.3 * (y + 1)) / 2;
        positions.setXYZ(
          i,
          positions.getX(i) * 1.85 * taper + 0.35 - 0.62 * y,
          y * 1.92 - 0.35,
          positions.getZ(i) * 1.12 * taper - 0.03,
        );
      }
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshPhysicalMaterial({
          color: 0x914e62,
          roughness: 0.6,
          metalness: 0.05,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      heart.add(mesh);
      const atrium = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 24),
        new THREE.MeshPhysicalMaterial({
          color: 0xc38087,
          roughness: 0.65,
          transparent: true,
          opacity: 0.15,
          depthWrite: false,
        }),
      );
      atrium.position.set(-0.8, 0.72, -0.1);
      atrium.scale.set(0.83, 0.62, 0.78);
      heart.add(atrium);
      anatomy.add(heart);
      const branchPoint = (name: string, t: number): Vec3 =>
        curve(CORONARIES.find((b) => b.name === name)!.points)
          .getPoint(t)
          .toArray() as Vec3;
      const aortaLabel = label(t("上行大動脈 Ao"), [-1.9, 2.6, -1]);
      aortaLabel.userData.messageKey = "上行大動脈 Ao";
      annotations.add(
        aortaLabel,
        label("LAD", branchPoint("LAD", 0.45)),
        label("LCx", branchPoint("LCX", 0.6)),
        label("RCA", branchPoint("RCA", 0.45)),
      );
    }
    const branches = CORONARIES.map((b) => {
      const base = coronaryTube(
        b,
        fluoro ? 0x68808d : 0xc1656c,
        fluoro ? 0.08 : 0.72,
      );
      anatomy.add(base);
      const fill = coronaryTube(b, fluoro ? 0xe0f5fb : 0x05a9a0, 0, 1.05);
      fill.visible = false;
      anatomy.add(fill);
      return { b, fill };
    });
    const entry = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xdca14e }),
    );
    scene.add(entry);
    let deviceKey = "";
    function update(s: SimulationState) {
      const key = `${s.access}:${s.wire}:${s.catheter}:${s.rotation}:${s.catheterType}:${s.active}:${s.target}:${s.root?.side}:${s.root?.seatAt}`;
      if (deviceKey === key) return;
      deviceKey = key;
      drawDirty = true;
      disposeObject(devices);
      devices.clear();
      if (s.catheter > 0)
        devices.add(
          polyline(
            catheterPoints(s),
            fluoro ? 0.028 : 0.038,
            fluoro ? 0xf5fafb : 0x2b6cdf,
          ),
        );
      if (s.wire > 0) {
        const wire = wireShape(s);
        devices.add(
          polyline(
            wire.points,
            fluoro ? 0.013 : 0.016,
            fluoro ? 0xfce6be : 0xd48b28,
          ),
        );
        const jTip = wire.points.slice(wire.tipStart);
        if (jTip.length >= 2)
          devices.add(
            polyline(
              jTip,
              fluoro ? 0.019 : 0.022,
              fluoro ? 0xffffff : 0xffc45d,
            ),
          );
      }
      entry.position.set(...ACCESS_POINTS[s.access]);
      entry.visible = !fluoro && options.current.view === "route";
    }
    function setView() {
      drawDirty = true;
      const { view: mode, heartVisible: visible } = options.current;
      heart.visible = visible;
      annotations.visible = !fluoro && mode === "heart";
      const route = mode === "route" && !fluoro;
      const im = options.current.imaging;
      const closeRoot = mode === "root" && !fluoro;
      const distance = route ? 27 : closeRoot ? 5 : 14;
      camera.zoom = fluoro ? fluoroMagnification(im) : 1;
      camera.updateProjectionMatrix();
      const center = new THREE.Vector3(
        closeRoot ? ROOT[0] : route ? -0.4 : 0.65,
        closeRoot ? ROOT[1] + 0.15 : route ? -1.3 : 0.1,
        closeRoot ? ROOT[2] : route ? -0.7 : -0.3,
      );
      const angle = ((fluoro ? im.yaw : 18) * Math.PI) / 180;
      const pitch = ((fluoro ? im.pitch : 7.4) * Math.PI) / 180;
      const direction = new THREE.Vector3(
        Math.sin(angle) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(angle) * Math.cos(pitch),
      );
      if (fluoro) {
        const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
        const up = new THREE.Vector3()
          .crossVectors(direction, right)
          .normalize();
        center.addScaledVector(right, im.panX).addScaledVector(up, im.panY);
      }
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center);
      camera.lookAt(center);
      controls.update();
      entry.visible = route;
    }
    api.current = {
      setLanguage: () => {
        renderer.domElement.setAttribute(
          "aria-label",
          options.current.t(
            fluoro
              ? "同じ3D血管から計算した模式透視"
              : "心臓とカテーテルの3Dモデル",
          ),
        );
        annotations.children.forEach((sprite) => {
          if (sprite.userData.messageKey)
            sprite.userData.setText(
              options.current.t(sprite.userData.messageKey),
            );
        });
        drawDirty = true;
      },
      update,
      setView,
      invalidate: () => {
        drawDirty = true;
      },
    };
    setView();
    update(latest.current);
    const resize = () => {
      drawDirty = true;
      if (!host.current) return;
      const { width, height } = host.current.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    let raf = 0;
    let previous = 0,
      previousSimTime = -1;
    let wasAnimating = false;
    let captureId = options.current.imaging.captureId;
    let wasEnabled = options.current.imaging.enabled;
    let recording = false,
      recordStart = 0,
      lastRecord = -1;
    let frames: CapturedFrame[] = [];
    let renderedFrame: Omit<CapturedFrame, "image"> | null = null;
    const snapshot = (): CapturedFrame | null =>
      renderedFrame
        ? {
            ...renderedFrame,
            image: renderer.domElement.toDataURL("image/jpeg", 0.78),
          }
        : null;
    options.current.onSnapshotReady?.(snapshot);
    const finishCine = () => {
      if (frames.length > 1)
        options.current.onCine?.({
          frames,
          duration: frames.at(-1)!.time - frames[0].time,
        });
      frames = [];
      recording = false;
    };
    function frame(time: number) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || time - previous < 32) return;
      previous = time;
      if (
        !fluoro &&
        !options.current.visible &&
        !options.current.imaging.recording &&
        !recording &&
        captureId === options.current.imaging.captureId
      )
        return;
      const s = latest.current,
        im = options.current.imaging;
      if (
        fluoro &&
        recording &&
        (!im.recording || !im.enabled || s.time < recordStart)
      )
        finishCine();
      if (fluoro && !im.enabled) {
        wasEnabled = false;
        return;
      }
      if (!wasEnabled) {
        drawDirty = true;
        wasEnabled = true;
      }
      if (fluoro && im.recording && !recording) {
        recording = true;
        recordStart = s.time;
        lastRecord = -1;
        frames = [];
      }
      const animating =
        s.bolus !== null &&
        s.time - s.bolus.start < s.bolus.duration + 8 &&
        previousSimTime !== s.time;
      previousSimTime = s.time;
      controls.update();
      if (
        !drawDirty &&
        !animating &&
        !wasAnimating &&
        !recording &&
        captureId === im.captureId
      )
        return;
      drawDirty = false;
      wasAnimating = animating;
      branches.forEach(({ b, fill }) => {
        const { front, opacity } = contrastField(s, b.side, b.delay);
        fill.visible = opacity > 0 && front > 0;
        fill.material instanceof THREE.MeshStandardMaterial &&
          (fill.material.opacity = opacity);
        fill.geometry.setDrawRange(
          0,
          Math.floor((front * fill.geometry.getIndex()!.count) / 3) * 3,
        );
      });
      controls.update();
      renderer.setScissorTest(false);
      renderer.render(scene, camera);
      if (fluoro) {
        // Opaque collimator blades are part of the saved image, not just a UI overlay.
        const size = renderer.getSize(new THREE.Vector2()),
          w = size.x,
          h = size.y;
        const x = Math.round((w * (1 - im.width)) / 2),
          y = Math.round((h * (1 - im.height)) / 2);
        renderer.setScissorTest(true);
        renderer.setClearColor(0x050a0d, 1);
        for (const rect of [
          [0, 0, x, h],
          [w - x, 0, x, h],
          [0, 0, w, y],
          [0, h - y, w, y],
        ]) {
          if (rect[2] > 0 && rect[3] > 0) {
            renderer.setScissor(...(rect as [number, number, number, number]));
            renderer.clear(true, false, false);
          }
        }
        renderer.setScissorTest(false);
        renderer.setClearColor(0x192630, 1);
        // Metadata belongs to the pixels just rendered, not to the next UI setting.
        renderedFrame = {
          time: s.time,
          projection: {
            yaw: im.yaw,
            pitch: im.pitch,
            fieldOfViewInch: im.fieldOfViewInch,
            zoom: im.zoom,
          },
        };
        if (captureId !== im.captureId) {
          captureId = im.captureId;
          const still = snapshot();
          if (still) options.current.onCapture?.(still);
        }
        if (recording && s.time - lastRecord >= 0.12) {
          const captured = snapshot();
          if (captured) frames.push(captured);
          lastRecord = s.time;
        }
        if (recording && (frames.length >= 120 || s.time - recordStart >= 15))
          finishCine();
      }
    }
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      options.current.onSnapshotReady?.(null);
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      disposeObject(scene);
      annotations.children.forEach((c) => c.userData.texture?.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [fluoro]);
  useEffect(() => {
    api.current?.setLanguage();
  }, [locale]);
  useEffect(() => {
    api.current?.update(state);
  }, [state]);
  useEffect(() => {
    api.current?.setView();
  }, [view, projection, heartVisible, resetKey, imaging]);
  useEffect(() => {
    api.current?.invalidate();
  }, [visible]);
  return (
    <div
      className={`anatomy-canvas ${fluoro ? "fluoro-canvas" : ""}`}
      ref={host}
      data-testid={fluoro ? "fluoro-canvas" : "anatomy-canvas"}
      data-model-state={modelState}
      data-catheter-phase={rootManeuver(state)}
      data-catheter-insertion={state.catheter.toFixed(3)}
      data-catheter-rotation={state.rotation.toFixed(3)}
      data-catheter-tip={catheterDisplayTip(state)
        .toArray()
        .map((x) => x.toFixed(6))
        .join(",")}
      data-field-of-view={fluoro ? imaging.fieldOfViewInch : undefined}
      data-magnification={
        fluoro ? fluoroMagnification(imaging).toFixed(4) : undefined
      }
      data-angle={fluoro ? `${imaging.yaw},${imaging.pitch}` : undefined}
      data-exposure={fluoro ? String(imaging.enabled) : undefined}
      data-contrast={Math.max(
        contrastField(state, "LCA", 0).opacity,
        contrastField(state, "RCA", 0).opacity,
      ).toFixed(3)}
      data-wire-phase={wireShape(state).phase}
      data-wire-loop={wireShape(state).loop.toFixed(3)}
    >
      {modelState === "error" && (
        <div className="model-error">
          {t(
            "実形状モデルを読み込めませんでした。ページを再読み込みしてください。",
          )}
        </div>
      )}
      {failed && (
        <div className="render-error">
          {t(
            "3D表示を開始できませんでした。WebGLが有効なブラウザで開き直してください。",
          )}
        </div>
      )}
    </div>
  );
}
