"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  createOffsetPlane,
  createPerpendicularPlane,
  createSketch,
  deleteSketch,
  saveSketchGeometry,
} from "./actions";

type Vec3 = { x: number; y: number; z: number };
type Axis = "XY" | "YZ" | "XZ";
type PointRec = { id: string; x: number; y: number; z: number };
type EdgeRec = { id: string; fromId: string; toId: string };
type SketchData = { id: string; name: string; points: PointRec[]; edges: EdgeRec[] };
type PlaneData = {
  id: string;
  label: string;
  origin: Vec3;
  normal: Vec3;
  uAxis: Vec3;
  sketches: SketchData[];
};

const PAPER_BG = 0xfaf6ee;
const PENCIL = 0x4b4b4b;
const PENCIL_DIM = 0xcfc7b8;
const PLANE_CARD = 0x9a9284;
const PLANE_CARD_ACTIVE = 0x4b4b4b;
const SELECT_COLOR = 0xc2410c; // 선택된 선/끝점 강조색 (주황)
const CARD_SIZE = 1.2; // scene 단위 (=1200mm)
const GRID_SIZE = 10; // scene 단위 (=10m)
const FLAT_DISTANCE = 8; // 스케치 정면 뷰 카메라 거리 (scene 단위)

// 모든 좌표·오프셋 값의 단위는 mm. Three.js 씬 내부는 보기 좋은 스케일을 위해
// 1 scene 단위 = 1000mm(=1m)로 렌더링만 축소해서 그린다.
const MM_PER_SCENE_UNIT = 1000;
function mmToScene(mm: number) {
  return mm / MM_PER_SCENE_UNIT;
}
function sceneToMm(units: number) {
  return Math.round(units * MM_PER_SCENE_UNIT);
}

function vecMm(v: Vec3) {
  return new THREE.Vector3(mmToScene(v.x), mmToScene(v.y), mmToScene(v.z));
}
function vecUnit(v: Vec3) {
  return new THREE.Vector3(v.x, v.y, v.z).normalize();
}
function planeBasis(plane: PlaneData) {
  const origin = vecMm(plane.origin);
  const normal = vecUnit(plane.normal);
  const uAxis = vecUnit(plane.uAxis);
  const vAxis = normal.clone().cross(uAxis).normalize();
  return { origin, normal, uAxis, vAxis };
}
function planeQuaternion(plane: PlaneData) {
  const { uAxis, vAxis, normal } = planeBasis(plane);
  const m = new THREE.Matrix4().makeBasis(uAxis, vAxis, normal);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function toThreePlane(plane: PlaneData): THREE.Plane {
  const { origin, normal } = planeBasis(plane);
  return new THREE.Plane(normal, -normal.dot(origin));
}

// 평면 자신의 가로(uAxis)·세로(vAxis) 기준 2D 좌표로 변환/역변환.
// "수평·수직" 마그네틱 스냅은 전역 XYZ가 아니라 이 평면 기준으로 판단해야
// 기울어진(수직 평면에서 파생된) 평면에서도 자연스럽다.
function toLocalUV(plane: PlaneData, worldScene: THREE.Vector3): { u: number; v: number } {
  const { origin, uAxis, vAxis } = planeBasis(plane);
  const rel = worldScene.clone().sub(origin);
  return { u: rel.dot(uAxis), v: rel.dot(vAxis) };
}
function fromLocalUV(plane: PlaneData, u: number, v: number): THREE.Vector3 {
  const { origin, uAxis, vAxis } = planeBasis(plane);
  return origin.clone().add(uAxis.clone().multiplyScalar(u)).add(vAxis.clone().multiplyScalar(v));
}

const ORTHO_SNAP_DEG = 8; // 터치로는 5도가 너무 빡빡해서 조금 넉넉하게

// 기준점(ref)에서 목표점까지의 방향이 수평·수직에서 ORTHO_SNAP_DEG 이내면
// 그쪽으로 딱 맞춘다 ("마그네틱" 느낌의 직교 스냅).
function orthoSnapLocal(
  ref: { u: number; v: number },
  target: { u: number; v: number }
): { u: number; v: number } {
  const du = target.u - ref.u;
  const dv = target.v - ref.v;
  if (Math.hypot(du, dv) < 1e-6) return target;
  const angleDeg = Math.atan2(Math.abs(dv), Math.abs(du)) * (180 / Math.PI);
  if (angleDeg < ORTHO_SNAP_DEG) return { u: target.u, v: ref.v }; // 수평
  if (angleDeg > 90 - ORTHO_SNAP_DEG) return { u: ref.u, v: target.v }; // 수직
  return target;
}

function distanceMm(a: Vec3, b: Vec3) {
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
}

function snapMm(mm: number, size: number) {
  if (size <= 0) return mm;
  return Math.round(mm / size) * size;
}

function createLabelDiv(text: string) {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.pointerEvents = "none";
  div.style.padding = "1px 5px";
  div.style.borderRadius = "3px";
  div.style.fontSize = "11px";
  div.style.fontFamily = "inherit";
  div.style.background = "rgba(250, 246, 238, 0.9)";
  div.style.color = "#4b4b4b";
  div.style.border = "1px solid rgba(75, 75, 75, 0.25)";
  div.style.whiteSpace = "nowrap";
  return div;
}

// 치수 라벨을 클릭하면 숫자를 직접 입력해서 길이를 바꿀 수 있게 만든다
// (from 점은 고정, to 점이 새 길이에 맞게 같은 방향으로 이동).
function createEditableLabelDiv(text: string, onCommit: (mm: number) => void) {
  const div = createLabelDiv(text);
  div.style.pointerEvents = "auto";
  div.style.cursor = "pointer";

  div.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  div.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const input = document.createElement("input");
    input.type = "number";
    input.value = div.textContent?.replace("mm", "") ?? "";
    input.style.width = "60px";
    input.style.fontSize = "11px";
    input.style.padding = "0 2px";
    input.style.border = "1px solid #c2410c";
    input.style.borderRadius = "3px";
    input.style.background = "#fff";
    input.style.color = "#4b4b4b";
    input.addEventListener("pointerdown", (e2) => e2.stopPropagation());
    input.addEventListener("click", (e2) => e2.stopPropagation());

    const commit = () => {
      const value = parseFloat(input.value);
      if (!Number.isNaN(value) && value > 0) onCommit(value);
    };
    input.addEventListener("keydown", (kev) => {
      if (kev.key === "Enter") input.blur();
      if (kev.key === "Escape") {
        input.removeEventListener("blur", commit);
        div.textContent = text;
      }
    });
    input.addEventListener("blur", commit);

    div.replaceChildren(input);
    input.focus();
    input.select();
  });
  return div;
}

const TAP_MAX_MOVE = 8; // px
const TAP_MAX_MS = 500;

// 컴포넌트 스코프 밖의 평범한 함수로 둬야 eslint(react-hooks/purity)가
// Date.now() 호출을 "렌더 중 impure 호출"로 오인하지 않는다.
function isTap(down: { x: number; y: number; time: number }, up: { x: number; y: number }) {
  const dist = Math.hypot(up.x - down.x, up.y - down.y);
  const elapsedMs = Date.now() - down.time;
  return dist <= TAP_MAX_MOVE && elapsedMs <= TAP_MAX_MS;
}
function nowMs() {
  return Date.now();
}

export default function ProjectCanvas({
  projectId,
  projectName,
  planes,
}: {
  projectId: string;
  projectName: string;
  planes: PlaneData[];
}) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const gizmoMountRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const planeCardGroupRef = useRef<THREE.Group | null>(null);
  const refGeometryGroupRef = useRef<THREE.Group | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const activePointGroupRef = useRef<THREE.Group | null>(null);
  const activeEdgeGroupRef = useRef<THREE.Group | null>(null);
  const activeLabelGroupRef = useRef<THREE.Group | null>(null);
  const previewGroupRef = useRef<THREE.Group | null>(null);

  const activePointMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const activeEdgeLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const activeEdgeLabelsRef = useRef<Map<string, CSS2DObject>>(new Map());
  const activePointsRef = useRef<Map<string, PointRec>>(new Map());
  const activeEdgesRef = useRef<Map<string, EdgeRec>>(new Map());
  const lastPointIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const previewLineRef = useRef<THREE.Line | null>(null);
  const previewLabelRef = useRef<CSS2DObject | null>(null);
  const draggingPointIdRef = useRef<string | null>(null);
  const lastMouseClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastPreviewDirRef = useRef<THREE.Vector3 | null>(null);
  const typedLengthRef = useRef<string>("");

  const [mode, setMode] = useState<"overview" | "sketch">("overview");
  const [activePlaneId, setActivePlaneId] = useState<string | null>(null);
  const [activeSketchId, setActiveSketchId] = useState<string | null>(null);
  const [tool, setTool] = useState<"pen" | "move">("pen");

  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    edgeId: string;
    sketchId: string;
    from: PointRec;
    to: PointRec;
  } | null>(null);
  const [pendingPerpEdge, setPendingPerpEdge] = useState<{ from: PointRec; to: PointRec } | null>(
    null
  );

  const [offsetInput, setOffsetInput] = useState("0");
  const [offsetAxis, setOffsetAxis] = useState<Axis>("XY");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number; z: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // 이동 도구에서 탭으로 선택한 점/선 (삭제용)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedActiveEdgeId, setSelectedActiveEdgeId] = useState<string | null>(null);

  // 격자 스냅: 켜두면 점 찍기/이동 좌표가 지정한 mm 간격으로 자동 정렬됨
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapSizeInput, setSnapSizeInput] = useState("50");

  // 그리는 중 키보드로 입력한 치수(숫자). 상태바 표시용이고 실제 값은 ref에 있다.
  const [typedLength, setTypedLength] = useState("");

  // 트리에서 접어둔 평면 id들 (CATIA 스타일 펼치기/접기)
  const [collapsedPlaneIds, setCollapsedPlaneIds] = useState<Set<string>>(new Set());

  const activePlane = planes.find((p) => p.id === activePlaneId) ?? null;

  // 아이패드 사파리에서 100vh는 주소창이 보였다 사라졌다 할 때 불안정해서
  // 페이지 자체가 스크롤되며 상단 툴바가 화면 밖으로 밀려 올라가 버린다.
  // body 스크롤을 잠그고, 아래 루트를 fixed inset-0으로 고정해서 막는다.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

  // ── Three.js 씬 초기화 ─────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PAPER_BG);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000
    );
    camera.position.set(6, 8, 5);
    camera.up.set(0, 0, 1); // Z축을 상하(수직) 방향으로 사용
    cameraRef.current = camera;

    mount.style.position = "relative";

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 치수(길이) 라벨을 HTML로 캔버스 위에 겹쳐 그리기 위한 오버레이 렌더러.
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // ── 방향 축(기즈모): 화면 구석에서 지금 카메라가 보는 방향을 보여준다 ──
    const gizmoMount = gizmoMountRef.current;
    let gizmoRenderer: THREE.WebGLRenderer | null = null;
    let gizmoLabelRenderer: CSS2DRenderer | null = null;
    let gizmoScene: THREE.Scene | null = null;
    let gizmoCamera: THREE.OrthographicCamera | null = null;
    const GIZMO_SIZE = 72;
    if (gizmoMount) {
      gizmoScene = new THREE.Scene();
      gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);

      gizmoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      gizmoRenderer.setPixelRatio(window.devicePixelRatio);
      gizmoRenderer.setSize(GIZMO_SIZE, GIZMO_SIZE);
      gizmoRenderer.setClearColor(0x000000, 0);
      gizmoMount.appendChild(gizmoRenderer.domElement);

      gizmoLabelRenderer = new CSS2DRenderer();
      gizmoLabelRenderer.setSize(GIZMO_SIZE, GIZMO_SIZE);
      gizmoLabelRenderer.domElement.style.position = "absolute";
      gizmoLabelRenderer.domElement.style.top = "0";
      gizmoLabelRenderer.domElement.style.left = "0";
      gizmoLabelRenderer.domElement.style.pointerEvents = "none";
      gizmoMount.appendChild(gizmoLabelRenderer.domElement);

      const axes: { dir: THREE.Vector3; color: number; label: string }[] = [
        { dir: new THREE.Vector3(1, 0, 0), color: 0xd9534f, label: "X" },
        { dir: new THREE.Vector3(0, 1, 0), color: 0x4caf50, label: "Y" },
        { dir: new THREE.Vector3(0, 0, 1), color: 0x3d7fc9, label: "Z" },
      ];
      for (const { dir, color, label } of axes) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir]);
        const mat = new THREE.LineBasicMaterial({ color });
        gizmoScene.add(new THREE.Line(geo, mat));

        const div = document.createElement("div");
        div.textContent = label;
        div.style.color = `#${color.toString(16).padStart(6, "0")}`;
        div.style.fontSize = "11px";
        div.style.fontWeight = "700";
        div.style.pointerEvents = "none";
        const labelObj = new CSS2DObject(div);
        labelObj.position.copy(dir.clone().multiplyScalar(1.3));
        gizmoScene.add(labelObj);
      }
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    // 좌클릭/한 손가락 탭은 회전에 쓰지 않고 점 찍기·선택용으로 남겨둔다.
    // 회전은 마우스 가운데 버튼이나 두 손가락 제스처로만 하도록 제한한다.
    // (그대로 두면 OrbitControls가 탭/클릭을 소비해서 그리기·선택 클릭이 씹힌다)
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: null as unknown as THREE.TOUCH,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1));

    const planeCardGroup = new THREE.Group();
    const refGeometryGroup = new THREE.Group();
    const gridGroup = new THREE.Group();
    const activePointGroup = new THREE.Group();
    const activeEdgeGroup = new THREE.Group();
    const activeLabelGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    scene.add(
      planeCardGroup,
      refGeometryGroup,
      gridGroup,
      activePointGroup,
      activeEdgeGroup,
      activeLabelGroup,
      previewGroup
    );
    planeCardGroupRef.current = planeCardGroup;
    refGeometryGroupRef.current = refGeometryGroup;
    gridGroupRef.current = gridGroup;
    activePointGroupRef.current = activePointGroup;
    activeEdgeGroupRef.current = activeEdgeGroup;
    activeLabelGroupRef.current = activeLabelGroup;
    previewGroupRef.current = previewGroup;

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);

      if (gizmoRenderer && gizmoLabelRenderer && gizmoScene && gizmoCamera) {
        const dir = camera.position.clone().sub(controls.target);
        if (dir.lengthSq() > 1e-6) {
          gizmoCamera.position.copy(dir.normalize().multiplyScalar(4));
          gizmoCamera.up.copy(camera.up);
          gizmoCamera.lookAt(0, 0, 0);
        }
        gizmoRenderer.render(gizmoScene, gizmoCamera);
        gizmoLabelRenderer.render(gizmoScene, gizmoCamera);
      }

      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      if (gizmoMount && gizmoRenderer) {
        gizmoRenderer.dispose();
        gizmoMount.removeChild(gizmoRenderer.domElement);
      }
      if (gizmoMount && gizmoLabelRenderer) {
        gizmoMount.removeChild(gizmoLabelRenderer.domElement);
      }
    };
  }, []);

  // ── 평면 카드(작은 네모) + 다른 스케치들의 참고용 지오메트리 렌더 ──
  useEffect(() => {
    const scene = sceneRef.current;
    const cardGroup = planeCardGroupRef.current;
    const refGroup = refGeometryGroupRef.current;
    if (!scene || !cardGroup || !refGroup) return;

    while (cardGroup.children.length) {
      const m = cardGroup.children.pop() as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    while (refGroup.children.length) {
      const obj = refGroup.children.pop() as THREE.Line | THREE.Mesh;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }

    for (const plane of planes) {
      const isActive = plane.id === activePlaneId && mode === "sketch";
      const isSelected = plane.id === selectedPlaneId;
      if (!isActive) {
        const geo = new THREE.PlaneGeometry(CARD_SIZE, CARD_SIZE);
        const mat = new THREE.MeshBasicMaterial({
          color: isSelected ? PLANE_CARD_ACTIVE : PLANE_CARD,
          transparent: true,
          opacity: isSelected ? 0.15 : 0.1,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const { origin } = planeBasis(plane);
        mesh.position.copy(origin);
        mesh.quaternion.copy(planeQuaternion(plane));
        mesh.userData = { kind: "plane", planeId: plane.id };
        cardGroup.add(mesh);
      }

      for (const sketch of plane.sketches) {
        if (mode === "sketch" && sketch.id === activeSketchId) continue; // 활성 스케치는 별도 그룹에서 그림
        const pointById = new Map(sketch.points.map((p) => [p.id, p]));
        const highlightedPointIds = new Set<string>();

        for (const e of sketch.edges) {
          const from = pointById.get(e.fromId);
          const to = pointById.get(e.toId);
          if (!from || !to) continue;
          const isSelectedEdge = selectedEdge?.edgeId === e.id;
          if (isSelectedEdge) {
            highlightedPointIds.add(from.id);
            highlightedPointIds.add(to.id);
          }
          const geo = new THREE.BufferGeometry().setFromPoints([
            vecMm(from),
            vecMm(to),
          ]);
          const mat = new THREE.LineBasicMaterial({
            color: isSelectedEdge ? SELECT_COLOR : PENCIL_DIM,
            linewidth: isSelectedEdge ? 3 : 1,
          });
          const line = new THREE.Line(geo, mat);
          line.userData = {
            kind: "edge",
            edgeId: e.id,
            sketchId: sketch.id,
            from,
            to,
          };
          refGroup.add(line);
        }

        for (const p of sketch.points) {
          const isHighlighted = highlightedPointIds.has(p.id);
          const geo = new THREE.SphereGeometry(isHighlighted ? 0.09 : 0.045, 12, 12);
          const mat = new THREE.MeshBasicMaterial({
            color: isHighlighted ? SELECT_COLOR : PENCIL_DIM,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(vecMm(p));
          refGroup.add(mesh);
        }
      }
    }
  }, [planes, activePlaneId, activeSketchId, mode, selectedPlaneId, selectedEdge]);

  // ── 활성 스케치용 점/선 메시 헬퍼 ──────────────────────────────
  function addActivePointMesh(id: string, p: PointRec) {
    const geo = new THREE.SphereGeometry(0.06, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: PENCIL });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(mmToScene(p.x), mmToScene(p.y), mmToScene(p.z));
    activePointGroupRef.current?.add(mesh);
    activePointMeshesRef.current.set(id, mesh);
  }
  function removeActivePointMesh(id: string) {
    const mesh = activePointMeshesRef.current.get(id);
    if (!mesh) return;
    activePointGroupRef.current?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    activePointMeshesRef.current.delete(id);
  }
  function addActiveEdgeLine(e: EdgeRec) {
    const from = activePointsRef.current.get(e.fromId);
    const to = activePointsRef.current.get(e.toId);
    if (!from || !to) return;
    const geo = new THREE.BufferGeometry().setFromPoints([vecMm(from), vecMm(to)]);
    const mat = new THREE.LineBasicMaterial({ color: PENCIL });
    const line = new THREE.Line(geo, mat);
    line.userData = { kind: "edge", sketchId: activeSketchId, from, to };
    activeEdgeGroupRef.current?.add(line);
    activeEdgeLinesRef.current.set(e.id, line);

    const labelDiv = createEditableLabelDiv(`${distanceMm(from, to)}mm`, (mm) =>
      applyEdgeLength(e.id, mm)
    );
    const label = new CSS2DObject(labelDiv);
    label.position.copy(vecMm(from).add(vecMm(to)).multiplyScalar(0.5));
    activeLabelGroupRef.current?.add(label);
    activeEdgeLabelsRef.current.set(e.id, label);
  }
  // 치수 라벨에 직접 입력한 길이로 선을 맞춘다. from 점은 고정하고
  // to 점을 같은 방향으로 새 길이만큼 이동시킨다.
  function applyEdgeLength(edgeId: string, newLenMm: number) {
    const e = activeEdgesRef.current.get(edgeId);
    if (!e) return;
    const from = activePointsRef.current.get(e.fromId);
    const to = activePointsRef.current.get(e.toId);
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const curLen = Math.hypot(dx, dy, dz) || 1;
    const scale = newLenMm / curLen;
    movePointTo(
      e.toId,
      vecMm({ x: from.x + dx * scale, y: from.y + dy * scale, z: from.z + dz * scale })
    );
    dirtyRef.current = true;
  }
  function removeActiveEdgeLine(id: string) {
    const line = activeEdgeLinesRef.current.get(id);
    if (line) {
      activeEdgeGroupRef.current?.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      activeEdgeLinesRef.current.delete(id);
    }
    const label = activeEdgeLabelsRef.current.get(id);
    if (label) {
      activeLabelGroupRef.current?.remove(label);
      activeEdgeLabelsRef.current.delete(id);
    }
  }
  // 점 하나가 움직였을 때, 그 점이 끝점인 모든 선의 지오메트리와 치수
  // 라벨을 다시 계산한다 (점 드래그 중 실시간으로 호출됨).
  function refreshEdgesForPoint(pointId: string) {
    for (const [edgeId, e] of activeEdgesRef.current) {
      if (e.fromId !== pointId && e.toId !== pointId) continue;
      const from = activePointsRef.current.get(e.fromId);
      const to = activePointsRef.current.get(e.toId);
      if (!from || !to) continue;

      const line = activeEdgeLinesRef.current.get(edgeId);
      if (line) {
        const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
        const fromVec = vecMm(from);
        const toVec = vecMm(to);
        posAttr.setXYZ(0, fromVec.x, fromVec.y, fromVec.z);
        posAttr.setXYZ(1, toVec.x, toVec.y, toVec.z);
        posAttr.needsUpdate = true;
        line.userData = { ...line.userData, from, to };
      }

      const label = activeEdgeLabelsRef.current.get(edgeId);
      if (label) {
        label.position.copy(vecMm(from).add(vecMm(to)).multiplyScalar(0.5));
        label.element.textContent = `${distanceMm(from, to)}mm`;
      }
    }
  }
  function clearActiveGeometry() {
    for (const id of [...activePointMeshesRef.current.keys()]) removeActivePointMesh(id);
    for (const id of [...activeEdgeLinesRef.current.keys()]) removeActiveEdgeLine(id);
    activePointsRef.current.clear();
    activeEdgesRef.current.clear();
    lastPointIdRef.current = null;
  }

  // ── 스케치 진입 시 그리드 + 카메라 정면 뷰 ─────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const gridGroup = gridGroupRef.current;
    if (!scene || !gridGroup) return;

    while (gridGroup.children.length) {
      const obj = gridGroup.children.pop() as THREE.Mesh;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }

    if (mode !== "sketch" || !activePlane) return;

    const geo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE, GRID_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      color: PENCIL_DIM,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const { origin } = planeBasis(activePlane);
    mesh.position.copy(origin);
    mesh.quaternion.copy(planeQuaternion(activePlane));
    gridGroup.add(mesh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activePlaneId]);

  function snapCameraFlat(plane: PlaneData) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { origin, normal, vAxis } = planeBasis(plane);
    camera.position.copy(origin.clone().add(normal.clone().multiplyScalar(FLAT_DISTANCE)));
    camera.up.copy(vAxis);
    controls.target.copy(origin);
    camera.lookAt(origin);
    controls.update();
  }

  // ── 스케치 진입/이탈 ────────────────────────────────────────────
  // 기존 스케치를 열 때는 "수정" 상태로 시작하고(실수로 선이 이어지지
  // 않게), 방금 만든 빈 스케치는 바로 그릴 수 있게 "그리기" 상태로 연다.
  function enterSketch(plane: PlaneData, sketch: SketchData, startTool: "pen" | "move" = "move") {
    clearActiveGeometry();
    for (const p of sketch.points) activePointsRef.current.set(p.id, p);
    for (const e of sketch.edges) activeEdgesRef.current.set(e.id, e);
    for (const [id, p] of activePointsRef.current) addActivePointMesh(id, p);
    for (const [, e] of activeEdgesRef.current) addActiveEdgeLine(e);
    setPointCount(activePointsRef.current.size);
    setEdgeCount(activeEdgesRef.current.size);
    dirtyRef.current = false;

    setActivePlaneId(plane.id);
    setActiveSketchId(sketch.id);
    setMode("sketch");
    setTool(startTool);
    setSelectedPlaneId(null);
    setSelectedEdge(null);
    setPendingPerpEdge(null);
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    snapCameraFlat(plane);
  }

  function exitSketch() {
    if (dirtyRef.current) {
      const ok = confirm("저장하지 않은 변경사항이 있습니다. 저장하지 않고 나가시겠습니까?");
      if (!ok) return;
    }
    clearActiveGeometry();
    hideDrawPreview();
    draggingPointIdRef.current = null;
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    setActivePlaneId(null);
    setActiveSketchId(null);
    setMode("overview");
    router.refresh();
  }

  function togglePlaneCollapsed(planeId: string) {
    setCollapsedPlaneIds((prev) => {
      const next = new Set(prev);
      if (next.has(planeId)) next.delete(planeId);
      else next.add(planeId);
      return next;
    });
  }

  async function handleCreateSketch(plane: PlaneData) {
    setBusy(true);
    try {
      const sketch = await createSketch(projectId, plane.id);
      enterSketch(plane, { id: sketch.id, name: sketch.name, points: [], edges: [] }, "pen");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSketch(sketch: SketchData) {
    if (!confirm(`"${sketch.name}" 스케치를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    try {
      await deleteSketch(projectId, sketch.id);
      if (sketch.id === activeSketchId) {
        clearActiveGeometry();
        setActivePlaneId(null);
        setActiveSketchId(null);
        setMode("overview");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── 평면 추가(오프셋) ──────────────────────────────────────────
  async function handleAddOffsetPlane() {
    const offset = parseFloat(offsetInput);
    if (Number.isNaN(offset)) return;
    setBusy(true);
    try {
      await createOffsetPlane(projectId, offsetAxis, offset);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── 선택한 선의 끝점 기준 수직 평면 생성 ───────────────────────
  async function handleCreatePerpPlane(point: PointRec) {
    if (!pendingPerpEdge) return;
    setBusy(true);
    try {
      const direction = {
        x: pendingPerpEdge.to.x - pendingPerpEdge.from.x,
        y: pendingPerpEdge.to.y - pendingPerpEdge.from.y,
        z: pendingPerpEdge.to.z - pendingPerpEdge.from.z,
      };
      await createPerpendicularPlane(projectId, point, direction);
      setPendingPerpEdge(null);
      setSelectedEdge(null);
      setSelectedActiveEdgeId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── 오버뷰 모드: 평면 카드/선 클릭으로 선택 ────────────────────
  function handleOverviewClick(clientX: number, clientY: number) {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera) return;

    const rect = mount.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.08 };
    raycaster.setFromCamera(mouse, camera);

    const targets = [
      ...(planeCardGroupRef.current?.children ?? []),
      ...(refGeometryGroupRef.current?.children ?? []),
      ...(activeEdgeGroupRef.current?.children ?? []),
    ];
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      setSelectedPlaneId(null);
      setSelectedEdge(null);
      return;
    }
    const obj = hits[0].object;
    if (obj.userData.kind === "plane") {
      setSelectedPlaneId(obj.userData.planeId);
      setSelectedEdge(null);
    } else if (obj.userData.kind === "edge") {
      setSelectedEdge({
        edgeId: obj.userData.edgeId,
        sketchId: obj.userData.sketchId,
        from: obj.userData.from,
        to: obj.userData.to,
      });
      setSelectedPlaneId(null);
    }
  }

  // ── 스케치 모드: 평면에 점 찍기 ─────────────────────────────────
  function raycastToActivePlane(clientX: number, clientY: number): THREE.Vector3 | null {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera || !activePlane) return null;

    const rect = mount.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const plane = toThreePlane(activePlane);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    return hit ? target : null;
  }

  function findNearbyActivePoint(pos: THREE.Vector3): string | null {
    let best: string | null = null;
    let bestDist = 0.18;
    for (const [id, p] of activePointsRef.current) {
      const d = pos.distanceTo(vecMm(p));
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // 점 하나를 찍고(가까운 점 있으면 그 점 사용), 이전 점이 있으면 선까지 잇는다.
  // 마우스 클릭과 키보드 치수 입력(Enter) 양쪽에서 공용으로 쓴다.
  function commitDrawPoint(target: THREE.Vector3) {
    let pointId = findNearbyActivePoint(target);
    if (!pointId) {
      pointId = `tmp_${crypto.randomUUID()}`;
      const rec: PointRec = {
        id: pointId,
        x: sceneToMm(target.x),
        y: sceneToMm(target.y),
        z: sceneToMm(target.z),
      };
      activePointsRef.current.set(pointId, rec);
      addActivePointMesh(pointId, rec);
      setPointCount(activePointsRef.current.size);
      dirtyRef.current = true;
    }

    const last = lastPointIdRef.current;
    if (last && last !== pointId) {
      const edgeId = `tmp_${crypto.randomUUID()}`;
      const rec: EdgeRec = { id: edgeId, fromId: last, toId: pointId };
      activeEdgesRef.current.set(edgeId, rec);
      addActiveEdgeLine(rec);
      setEdgeCount(activeEdgesRef.current.size);
      dirtyRef.current = true;
    }
    lastPointIdRef.current = pointId;
    clearTypedLength();
  }

  function handleDrawClick(clientX: number, clientY: number) {
    const raw = raycastToActivePlane(clientX, clientY);
    if (!raw) return;
    // 격자·직교 스냅보다 "근처 기존 점에 물리는 것"을 항상 우선한다.
    // 그렇지 않으면 도형을 닫으려고 첫 점 근처를 찍었을 때 마그네틱
    // 스냅이 커서를 다른 방향으로 틀어버려서 정확히 안 물릴 수 있다.
    const nearbyId = findNearbyActivePoint(raw);
    const target = nearbyId
      ? vecMm(activePointsRef.current.get(nearbyId)!)
      : applyOrthoSnap(applySnap(raw));
    commitDrawPoint(target);
  }

  // ── 그리는 중 고무줄(rubber-band) 미리보기 선 + 실시간 치수 라벨 ──
  // 커서 이동뿐 아니라 키보드로 숫자를 입력했을 때도 다시 그려야 하므로
  // clientX/clientY를 생략하면 마지막으로 기억해둔 마우스 위치를 쓴다.
  function updateDrawPreview(clientX?: number, clientY?: number) {
    if (clientX !== undefined && clientY !== undefined) {
      lastMouseClientRef.current = { x: clientX, y: clientY };
    }
    const mouse = lastMouseClientRef.current;
    const last = lastPointIdRef.current;
    const from = last ? activePointsRef.current.get(last) : null;
    const raw = mouse ? raycastToActivePlane(mouse.x, mouse.y) : null;
    if (!from || !raw) {
      hideDrawPreview();
      return;
    }
    const nearbyId = findNearbyActivePoint(raw);
    const snappedRaw = nearbyId
      ? vecMm(activePointsRef.current.get(nearbyId)!)
      : applyOrthoSnap(applySnap(raw));
    const fromVec = vecMm(from);

    let dir = snappedRaw.clone().sub(fromVec);
    if (dir.length() > 1e-6) {
      dir.normalize();
      lastPreviewDirRef.current = dir.clone();
    } else if (lastPreviewDirRef.current) {
      dir = lastPreviewDirRef.current.clone();
    } else {
      dir = new THREE.Vector3(1, 0, 0);
    }

    const typed = parseFloat(typedLengthRef.current);
    const hasTyped = typedLengthRef.current.length > 0 && !Number.isNaN(typed) && typed > 0;
    const target = hasTyped
      ? fromVec.clone().add(dir.multiplyScalar(mmToScene(typed)))
      : snappedRaw;

    if (!previewLineRef.current) {
      const geo = new THREE.BufferGeometry().setFromPoints([fromVec, target]);
      const mat = new THREE.LineDashedMaterial({
        color: SELECT_COLOR,
        dashSize: 0.08,
        gapSize: 0.05,
      });
      const line = new THREE.Line(geo, mat);
      previewGroupRef.current?.add(line);
      previewLineRef.current = line;
    } else {
      const posAttr = previewLineRef.current.geometry.attributes
        .position as THREE.BufferAttribute;
      posAttr.setXYZ(0, fromVec.x, fromVec.y, fromVec.z);
      posAttr.setXYZ(1, target.x, target.y, target.z);
      posAttr.needsUpdate = true;
    }
    previewLineRef.current.computeLineDistances();

    const lengthMm = hasTyped
      ? Math.round(typed)
      : distanceMm(
          { x: from.x, y: from.y, z: from.z },
          { x: sceneToMm(target.x), y: sceneToMm(target.y), z: sceneToMm(target.z) }
        );
    const mid = fromVec.clone().add(target).multiplyScalar(0.5);
    if (!previewLabelRef.current) {
      const label = new CSS2DObject(createLabelDiv(""));
      previewGroupRef.current?.add(label);
      previewLabelRef.current = label;
    }
    previewLabelRef.current.position.copy(mid);
    previewLabelRef.current.element.textContent = hasTyped
      ? `${lengthMm}mm ▎키보드 입력 중 (Enter)`
      : `${lengthMm}mm`;
  }
  function hideDrawPreview() {
    if (previewLineRef.current) {
      previewGroupRef.current?.remove(previewLineRef.current);
      previewLineRef.current.geometry.dispose();
      (previewLineRef.current.material as THREE.Material).dispose();
      previewLineRef.current = null;
    }
    if (previewLabelRef.current) {
      previewGroupRef.current?.remove(previewLabelRef.current);
      previewLabelRef.current = null;
    }
    lastPreviewDirRef.current = null;
    clearTypedLength();
  }

  // ── 키보드로 치수 직접 입력 (그리는 중, 숫자 입력 후 Enter) ──────
  function clearTypedLength() {
    typedLengthRef.current = "";
    setTypedLength("");
  }
  function handleDrawKeyDown(e: KeyboardEvent) {
    if (mode !== "sketch" || tool !== "pen" || !lastPointIdRef.current) return;
    if (/^[0-9.]$/.test(e.key)) {
      typedLengthRef.current += e.key;
      setTypedLength(typedLengthRef.current);
      updateDrawPreview();
    } else if (e.key === "Backspace") {
      typedLengthRef.current = typedLengthRef.current.slice(0, -1);
      setTypedLength(typedLengthRef.current);
      updateDrawPreview();
    } else if (e.key === "Enter") {
      const value = parseFloat(typedLengthRef.current);
      const last = lastPointIdRef.current;
      const from = last ? activePointsRef.current.get(last) : null;
      const dir = lastPreviewDirRef.current;
      if (from && dir && !Number.isNaN(value) && value > 0) {
        const target = vecMm(from).add(dir.clone().multiplyScalar(mmToScene(value)));
        commitDrawPoint(target);
        updateDrawPreview();
      }
    }
  }

  // 격자 스냅이 켜져 있으면 좌표(mm)를 지정한 간격으로 반올림한다.
  function applySnap(target: THREE.Vector3): THREE.Vector3 {
    if (!snapEnabled) return target;
    const size = parseFloat(snapSizeInput);
    if (!size || size <= 0) return target;
    return new THREE.Vector3(
      mmToScene(snapMm(sceneToMm(target.x), size)),
      mmToScene(snapMm(sceneToMm(target.y), size)),
      mmToScene(snapMm(sceneToMm(target.z), size))
    );
  }

  // 선을 그을 때 마지막 점(없으면 평면 원점) 기준으로 수평·수직에
  // 가까우면 딱 맞춰주는 마그네틱 스냅.
  function applyOrthoSnap(target: THREE.Vector3): THREE.Vector3 {
    if (!activePlane) return target;
    const last = lastPointIdRef.current
      ? activePointsRef.current.get(lastPointIdRef.current)
      : null;
    const refUV = last ? toLocalUV(activePlane, vecMm(last)) : { u: 0, v: 0 };
    const targetUV = toLocalUV(activePlane, target);
    const snappedUV = orthoSnapLocal(refUV, targetUV);
    return fromLocalUV(activePlane, snappedUV.u, snappedUV.v);
  }

  // 점을 옮길 때, 그 점과 연결된 이웃 점들 기준으로도 수평·수직이면
  // 마그네틱 스냅을 건다 (연결된 선이 여러 개면 순서대로 적용).
  function applyOrthoSnapForPoint(pointId: string, target: THREE.Vector3): THREE.Vector3 {
    if (!activePlane) return target;
    let result = target;
    for (const e of activeEdgesRef.current.values()) {
      const neighborId = e.fromId === pointId ? e.toId : e.toId === pointId ? e.fromId : null;
      if (!neighborId) continue;
      const neighbor = activePointsRef.current.get(neighborId);
      if (!neighbor) continue;
      const refUV = toLocalUV(activePlane, vecMm(neighbor));
      const targetUV = toLocalUV(activePlane, result);
      const snappedUV = orthoSnapLocal(refUV, targetUV);
      result = fromLocalUV(activePlane, snappedUV.u, snappedUV.v);
    }
    return result;
  }

  // ── 점 이동(드래그) ──────────────────────────────────────────────
  function movePointTo(pointId: string, targetRaw: THREE.Vector3) {
    const rec = activePointsRef.current.get(pointId);
    if (!rec) return;
    const target = applyOrthoSnapForPoint(pointId, applySnap(targetRaw));
    rec.x = sceneToMm(target.x);
    rec.y = sceneToMm(target.y);
    rec.z = sceneToMm(target.z);
    const mesh = activePointMeshesRef.current.get(pointId);
    mesh?.position.copy(target);
    refreshEdgesForPoint(pointId);
  }

  // ── 이동 도구: 점/선 선택 강조 + 삭제 ────────────────────────────
  function highlightActiveSelection(pointId: string | null, edgeId: string | null) {
    for (const [id, mesh] of activePointMeshesRef.current) {
      const isSel = id === pointId;
      (mesh.material as THREE.MeshBasicMaterial).color.set(isSel ? SELECT_COLOR : PENCIL);
      mesh.scale.setScalar(isSel ? 1.6 : 1);
    }
    for (const [id, line] of activeEdgeLinesRef.current) {
      (line.material as THREE.LineBasicMaterial).color.set(id === edgeId ? SELECT_COLOR : PENCIL);
    }
  }
  function selectActivePoint(id: string | null) {
    setSelectedPointId(id);
    setSelectedActiveEdgeId(null);
    highlightActiveSelection(id, null);
  }
  function selectActiveEdge(id: string | null) {
    setSelectedActiveEdgeId(id);
    setSelectedPointId(null);
    highlightActiveSelection(null, id);
  }
  function handleDeleteSelectedPoint() {
    if (!selectedPointId) return;
    const id = selectedPointId;
    for (const [eid, e] of [...activeEdgesRef.current]) {
      if (e.fromId !== id && e.toId !== id) continue;
      removeActiveEdgeLine(eid);
      activeEdgesRef.current.delete(eid);
    }
    removeActivePointMesh(id);
    activePointsRef.current.delete(id);
    if (lastPointIdRef.current === id) lastPointIdRef.current = null;
    setPointCount(activePointsRef.current.size);
    setEdgeCount(activeEdgesRef.current.size);
    dirtyRef.current = true;
    selectActivePoint(null);
  }
  function handleDeleteSelectedEdge() {
    if (!selectedActiveEdgeId) return;
    removeActiveEdgeLine(selectedActiveEdgeId);
    activeEdgesRef.current.delete(selectedActiveEdgeId);
    setEdgeCount(activeEdgesRef.current.size);
    dirtyRef.current = true;
    selectActiveEdge(null);
  }

  // OrbitControls는 터치 시작 시 제스처 종류와 무관하게 항상
  // preventDefault()를 호출해서, 브라우저가 탭을 click 이벤트로
  // 합성하는 걸 막아버린다. 그래서 click에 의존하지 않고
  // pointerdown/pointerup을 직접 비교해서 "탭/클릭인지"를 판단한다.
  const pointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent) {
    pointerDownRef.current = { x: e.clientX, y: e.clientY, time: nowMs() };

    if (mode === "sketch" && tool === "move") {
      const target = raycastToActivePlane(e.clientX, e.clientY);
      if (target) {
        const pointId = findNearbyActivePoint(target);
        if (pointId) {
          draggingPointIdRef.current = pointId;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }
    }
  }

  function handleActiveEdgeTap(clientX: number, clientY: number) {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera) return;
    const rect = mount.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.08 };
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(activeEdgeGroupRef.current?.children ?? [], false);
    if (hits.length === 0) {
      selectActivePoint(null);
      return;
    }
    const edgeId = [...activeEdgeLinesRef.current.entries()].find(
      ([, line]) => line === hits[0].object
    )?.[0];
    selectActiveEdge(edgeId ?? null);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;

    if (draggingPointIdRef.current) {
      const draggedId = draggingPointIdRef.current;
      draggingPointIdRef.current = null;
      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) {
        selectActivePoint(draggedId); // 거의 안 움직였으면 이동이 아니라 "선택"으로 처리
      } else {
        dirtyRef.current = true;
      }
      return;
    }

    if (!down) return;
    if (!isTap(down, { x: e.clientX, y: e.clientY })) return; // 드래그(회전)로 판단, 무시

    if (mode === "sketch") {
      if (tool === "pen") handleDrawClick(e.clientX, e.clientY);
      else if (tool === "move") handleActiveEdgeTap(e.clientX, e.clientY);
      return;
    }
    handleOverviewClick(e.clientX, e.clientY);
  }

  function handleCanvasMove(e: React.PointerEvent) {
    if (mode !== "sketch") return;

    if (draggingPointIdRef.current) {
      const target = raycastToActivePlane(e.clientX, e.clientY);
      if (!target) return;
      movePointTo(draggingPointIdRef.current, target);
      setCursorMm({ x: sceneToMm(target.x), y: sceneToMm(target.y), z: sceneToMm(target.z) });
      return;
    }

    if (tool !== "pen") return;
    const raw = raycastToActivePlane(e.clientX, e.clientY);
    if (!raw) return;
    const target = applyOrthoSnap(applySnap(raw));
    setCursorMm({ x: sceneToMm(target.x), y: sceneToMm(target.y), z: sceneToMm(target.z) });
    if (lastPointIdRef.current) updateDrawPreview(e.clientX, e.clientY);
  }

  function handleSetTool(next: "pen" | "move") {
    setTool(next);
    if (activePlane) snapCameraFlat(activePlane);
    hideDrawPreview();
    selectActivePoint(null);
  }

  function handleNewStroke() {
    lastPointIdRef.current = null;
    hideDrawPreview();
  }

  // 오토캐드처럼 우클릭이나 Esc로 지금 그리던 선을 끊는다(선택 해제도 함께).
  function handleCanvasContextMenu(e: React.MouseEvent) {
    if (mode !== "sketch") return;
    e.preventDefault();
    handleNewStroke();
  }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // 치수 라벨 편집창 등 다른 입력창에 타이핑 중이면 관여하지 않는다.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (mode !== "sketch") return;

      if (e.key === "Escape") {
        handleNewStroke();
        selectActivePoint(null);
        return;
      }
      handleDrawKeyDown(e);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tool]);

  function handleUndo() {
    const last = lastPointIdRef.current;
    if (!last) return;
    for (const [eid, e] of activeEdgesRef.current) {
      if (e.toId === last || e.fromId === last) {
        removeActiveEdgeLine(eid);
        activeEdgesRef.current.delete(eid);
      }
    }
    if (activePointsRef.current.get(last)?.id.startsWith("tmp_")) {
      removeActivePointMesh(last);
      activePointsRef.current.delete(last);
    }
    setPointCount(activePointsRef.current.size);
    setEdgeCount(activeEdgesRef.current.size);
    lastPointIdRef.current = null;
    hideDrawPreview();
    dirtyRef.current = true;
  }

  function handleClearAll() {
    if (!confirm("현재 스케치의 모든 점과 선을 지울까요? (저장 전까지는 되돌릴 수 있습니다)")) return;
    clearActiveGeometry();
    hideDrawPreview();
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    setPointCount(0);
    setEdgeCount(0);
    dirtyRef.current = true;
  }

  async function handleSave() {
    if (!activeSketchId) return;
    setSaving(true);
    try {
      const pointsArr = [...activePointsRef.current.values()];
      const edgesArr = [...activeEdgesRef.current.values()].map((e) => ({
        fromId: e.fromId,
        toId: e.toId,
      }));
      const result = await saveSketchGeometry(projectId, activeSketchId, pointsArr, edgesArr);

      clearActiveGeometry();
      hideDrawPreview();
      setSelectedPointId(null);
      setSelectedActiveEdgeId(null);
      for (const p of result.points) {
        activePointsRef.current.set(p.id, p);
        addActivePointMesh(p.id, p);
      }
      for (const e of result.edges) {
        activeEdgesRef.current.set(e.id, e);
        addActiveEdgeLine(e);
      }
      setPointCount(activePointsRef.current.size);
      setEdgeCount(activeEdgesRef.current.size);
      setSavedAt(new Date());
      dirtyRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  const selectedPlane = planes.find((p) => p.id === selectedPlaneId) ?? null;

  return (
    <div className="fixed inset-0 bg-[#faf6ee] overflow-hidden">
      {/* 좌측 트리 (캔버스 위에 떠 있는 패널, 레이아웃을 나누지 않음) */}
      <div className="absolute top-[4.75rem] left-3 z-10 w-64 max-h-[calc(100vh-5.5rem)] flex flex-col rounded-lg border border-black/10 bg-white/90 backdrop-blur-sm shadow-lg">
        <div className="px-3 py-3 border-b border-black/10">
          <p className="text-sm font-bold text-gray-900 truncate">{projectName}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 py-2 text-xs">
          {planes.map((plane) => {
            const isCollapsed = collapsedPlaneIds.has(plane.id);
            const isPlaneActive = plane.id === (mode === "sketch" ? activePlaneId : selectedPlaneId);
            const hasChildren = plane.sketches.length > 0;
            return (
              <div key={plane.id}>
                <div
                  onClick={() => {
                    setSelectedPlaneId(plane.id);
                    setSelectedEdge(null);
                  }}
                  className={`group w-full flex items-center gap-1 pr-1 py-1 rounded-md cursor-pointer ${
                    isPlaneActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-black/5"
                  }`}
                >
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren) togglePlaneCollapsed(plane.id);
                    }}
                    className="w-4 shrink-0 text-center text-[9px] leading-none select-none"
                  >
                    {hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
                  </span>
                  <svg
                    viewBox="0 0 16 16"
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isPlaneActive ? "text-white/80" : "text-gray-400"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  >
                    <path d="M2 5.5L8 2l6 3.5-6 3.5-6-3.5Z" />
                    <path d="M2 5.5v5L8 14l6-3.5v-5" />
                  </svg>
                  <span className="flex-1 truncate">{plane.label}</span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!busy) handleCreateSketch(plane);
                    }}
                    className="text-[10px] opacity-0 group-hover:opacity-70 hover:!opacity-100 px-1"
                    title="새 스케치 만들기"
                  >
                    +
                  </span>
                </div>
                {!isCollapsed &&
                  plane.sketches.map((sketch) => (
                    <div
                      key={sketch.id}
                      className={`group w-full flex items-center pl-5 pr-1 rounded-md ${
                        sketch.id === activeSketchId
                          ? "bg-gray-900/90 text-white"
                          : "text-gray-500 hover:bg-black/5"
                      }`}
                    >
                      <span className="w-4 shrink-0" />
                      <button
                        onClick={() => enterSketch(plane, sketch)}
                        className="flex-1 text-left py-1 truncate"
                      >
                        ✎ {sketch.name}{" "}
                        <span className="opacity-50">({sketch.points.length}점)</span>
                      </button>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!busy) handleDeleteSketch(sketch);
                        }}
                        className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 px-1"
                        title="스케치 삭제"
                      >
                        🗑
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* 캔버스 영역: 트리 패널 뒤까지 화면 전체를 채운다 */}
      <div className="absolute inset-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-black/10 bg-[#faf6ee]/90 backdrop-blur-sm">
          {mode === "overview" ? (
            <>
              <div className="flex items-center gap-1 mr-auto">
                <select
                  value={offsetAxis}
                  onChange={(e) => setOffsetAxis(e.target.value as Axis)}
                  className="text-xs border border-gray-300 rounded-md px-1.5 py-1.5 bg-white"
                >
                  <option value="XY">XY</option>
                  <option value="YZ">YZ</option>
                  <option value="XZ">XZ</option>
                </select>
                <input
                  value={offsetInput}
                  onChange={(e) => setOffsetInput(e.target.value)}
                  className="w-20 text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                  placeholder="거리(mm)"
                />
                <span className="text-[11px] text-gray-400">mm</span>
                <button
                  onClick={handleAddOffsetPlane}
                  disabled={busy}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 disabled:opacity-50"
                >
                  오프셋 평면 추가
                </button>
              </div>

              {selectedPlane && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">
                    선택된 평면: <b className="text-gray-800">{selectedPlane.label}</b>
                  </span>
                  <button
                    onClick={() => !busy && handleCreateSketch(selectedPlane)}
                    disabled={busy}
                    className="px-2 py-1 rounded bg-gray-900 text-white disabled:opacity-50"
                  >
                    새 스케치 만들기
                  </button>
                </div>
              )}

              {selectedEdge && !pendingPerpEdge && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">선 선택됨</span>
                  <button
                    onClick={() => {
                      const plane = planes.find((p) =>
                        p.sketches.some((s) => s.id === selectedEdge.sketchId)
                      );
                      const sketch = plane?.sketches.find((s) => s.id === selectedEdge.sketchId);
                      if (plane && sketch) enterSketch(plane, sketch);
                    }}
                    className="px-2 py-1 rounded border border-gray-300 text-gray-700"
                  >
                    스케치 열기
                  </button>
                  <button
                    onClick={() =>
                      setPendingPerpEdge({ from: selectedEdge.from, to: selectedEdge.to })
                    }
                    className="px-2 py-1 rounded bg-gray-900 text-white"
                  >
                    이 선에 수직인 평면 만들기
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={exitSketch}
                className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
              >
                ← 나가기
              </button>
              <span className="text-xs text-gray-400 mr-2">
                {activePlane?.label} ·{" "}
                {planes
                  .flatMap((p) => p.sketches)
                  .find((s) => s.id === activeSketchId)?.name}
              </span>
              <button
                onClick={() => handleSetTool(tool === "pen" ? "move" : "pen")}
                className={`text-xs px-2.5 py-1.5 rounded-md border ${
                  tool === "pen"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-300"
                }`}
                title={
                  tool === "pen"
                    ? "끄면 그린 점·선을 수정할 수 있어요"
                    : "켜면 이어서 선을 그릴 수 있어요"
                }
              >
                {tool === "pen" ? "✎ 그리는 중" : "✥ 수정 중 (그리기 켜기)"}
              </button>

              <label className="flex items-center gap-1 text-xs text-gray-500 px-1">
                <input
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={(e) => setSnapEnabled(e.target.checked)}
                />
                격자 스냅
              </label>
              <input
                value={snapSizeInput}
                onChange={(e) => setSnapSizeInput(e.target.value)}
                disabled={!snapEnabled}
                className="w-14 text-xs border border-gray-300 rounded-md px-1.5 py-1.5 bg-white disabled:opacity-50"
              />
              <span className="text-[11px] text-gray-400 mr-1">mm</span>

              {selectedPointId && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">점 선택됨</span>
                  <button
                    onClick={handleDeleteSelectedPoint}
                    className="px-2 py-1 rounded bg-red-500 text-white"
                  >
                    점 삭제
                  </button>
                  <button
                    onClick={() => selectActivePoint(null)}
                    className="px-2 py-1 rounded text-gray-400"
                  >
                    선택 해제
                  </button>
                </div>
              )}
              {selectedActiveEdgeId && !pendingPerpEdge && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">선 선택됨</span>
                  <button
                    onClick={() => {
                      const e = activeEdgesRef.current.get(selectedActiveEdgeId);
                      const from = e && activePointsRef.current.get(e.fromId);
                      const to = e && activePointsRef.current.get(e.toId);
                      if (from && to) setPendingPerpEdge({ from, to });
                    }}
                    className="px-2 py-1 rounded bg-gray-900 text-white"
                  >
                    이 선에 수직인 평면 만들기
                  </button>
                  <button
                    onClick={handleDeleteSelectedEdge}
                    className="px-2 py-1 rounded bg-red-500 text-white"
                  >
                    선 삭제
                  </button>
                  <button
                    onClick={() => selectActiveEdge(null)}
                    className="px-2 py-1 rounded text-gray-400"
                  >
                    선택 해제
                  </button>
                </div>
              )}

              <button
                onClick={handleNewStroke}
                className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
              >
                새 선 시작
              </button>
              <button
                onClick={handleUndo}
                className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
              >
                실행 취소
              </button>
              <button
                onClick={handleClearAll}
                className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
              >
                전체 지우기
              </button>
              <button
                onClick={() => {
                  const sketch = planes
                    .flatMap((p) => p.sketches)
                    .find((s) => s.id === activeSketchId);
                  if (sketch && !busy) handleDeleteSketch(sketch);
                }}
                className="text-xs px-2.5 py-1.5 rounded-md border border-red-200 bg-white text-red-500"
              >
                스케치 삭제
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="ml-auto text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </>
          )}

          {pendingPerpEdge && (
            <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
              <span className="text-gray-500">끝점을 선택하세요</span>
              <button
                onClick={() => !busy && handleCreatePerpPlane(pendingPerpEdge.from)}
                disabled={busy}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
              >
                시작점 ({pendingPerpEdge.from.x}, {pendingPerpEdge.from.y}, {pendingPerpEdge.from.z}
                )mm
              </button>
              <button
                onClick={() => !busy && handleCreatePerpPlane(pendingPerpEdge.to)}
                disabled={busy}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
              >
                끝점 ({pendingPerpEdge.to.x}, {pendingPerpEdge.to.y}, {pendingPerpEdge.to.z})mm
              </button>
              <button
                onClick={() => setPendingPerpEdge(null)}
                className="px-2 py-1 rounded text-gray-400"
              >
                취소
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-1 text-[11px] text-gray-400 flex gap-4">
          <span className="px-1.5 py-0.5 rounded bg-gray-900/5 text-gray-600 font-medium">
            단위: mm
          </span>
          {mode === "sketch" && (
            <>
              <span>
                점 {pointCount}개 · 선 {edgeCount}개
              </span>
              {cursorMm && (
                <span>
                  커서: {cursorMm.x}, {cursorMm.y}, {cursorMm.z} mm
                </span>
              )}
              {tool === "move" && (
                <span>점을 눌러서 이동하거나 탭해서 선택, 선을 탭해서 선택하세요.</span>
              )}
              {tool === "pen" && typedLength && (
                <span className="text-gray-600">
                  숫자 입력 중: {typedLength}mm (Enter로 확정, Esc로 취소)
                </span>
              )}
              {savedAt && <span>마지막 저장: {savedAt.toLocaleTimeString("ko-KR")}</span>}
            </>
          )}
          {mode === "overview" && <span>평면이나 선을 클릭해서 선택하세요.</span>}
        </div>

        <div
          ref={mountRef}
          className="flex-1"
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerMove={handleCanvasMove}
          onContextMenu={handleCanvasContextMenu}
        />
        <div
          ref={gizmoMountRef}
          className="absolute bottom-4 right-4 z-10 w-[72px] h-[72px] rounded-full bg-white/70 backdrop-blur-sm pointer-events-none"
        />
      </div>
    </div>
  );
}
