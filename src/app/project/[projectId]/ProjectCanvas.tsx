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
type PointRec = { id: string; x: number; y: number; z: number; isVertex?: boolean };
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
const PENCIL_DIM = 0xcfc7b8; // 평면 카드·그리드 등 "구성선"용 (연함)
const REF_EDGE = 0x9c9178; // 저장된 스케치의 실제 선/점 (구성선보다 진하게, 구분되도록)
const PLANE_CARD = 0x9a9284;
const PLANE_CARD_ACTIVE = 0x4b4b4b;
const SELECT_COLOR = 0xc2410c; // 선택된 선/끝점 강조색 (주황)
const CARD_SIZE = 1.2; // scene 단위 (=1200mm)
const GRID_SIZE = 10; // scene 단위 (=10m)
const BASE_GRID_WIDTH_MM = 1000; // XY 평면에 항상 깔아두는 모눈종이 크기 (가로, X)
const BASE_GRID_DEPTH_MM = 2000; // 모눈종이 크기 (세로, Y)
const BASE_GRID_SPACING_MM = 100; // 모눈 한 칸 크기
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
  // 손가락/펜/마우스로 누른 채 그은 궤적(삐뚤빼뚤해도 됨). 떼면 시작~끝을
  // 잇는 직선으로 확정된다.
  const strokeActiveRef = useRef(false);
  const strokeRawPointsRef = useRef<THREE.Vector3[]>([]);
  const freehandLineRef = useRef<THREE.Line | null>(null);
  const strokeStraightModeRef = useRef(false); // 이번 스트로크가 직선으로 전환됐는지
  const strokeHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 동시에 눌려있는 포인터(손가락) id 집합. 두 손가락째가 닿으면 그리기/드래그를
  // 즉시 취소하고 OrbitControls의 두 손가락 확대·회전 제스처에 넘겨준다.
  const activePointerIdsRef = useRef<Set<number>>(new Set());
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

  // 그리기 방식: 둘 다 꺼져 있으면(기본) 누른 채로 그은 궤적 그대로
  // 그려지다가 1초 이상 멈추면 그 순간부터 직선으로 바뀐다.
  // "이어그리기"를 켜면 탭으로 점을 찍어서 잇는 기존 방식.
  // "직선으로 그리기"를 켜면 궤적과 무관하게 항상 시작~끝 직선.
  const [chainMode, setChainMode] = useState(false);
  const [straightMode, setStraightMode] = useState(false);

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

    // ── 월드 원점(0,0,0) 방향 축 — 화면 고정 위젯이 아니라 실제 3D
    // 공간의 원점에 놓여서, 카메라를 돌리면 다른 지오메트리처럼 같이 돈다.
    const AXIS_LEN = 0.6;
    const axisDefs: { dir: THREE.Vector3; color: number; label: string }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xd9534f, label: "X" },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x4caf50, label: "Y" },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x3d7fc9, label: "Z" },
    ];
    for (const { dir, color, label } of axisDefs) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        dir.clone().multiplyScalar(AXIS_LEN),
      ]);
      const mat = new THREE.LineBasicMaterial({ color });
      scene.add(new THREE.Line(geo, mat));

      const div = document.createElement("div");
      div.textContent = label;
      div.style.color = `#${color.toString(16).padStart(6, "0")}`;
      div.style.fontSize = "11px";
      div.style.fontWeight = "700";
      div.style.pointerEvents = "none";
      const labelObj = new CSS2DObject(div);
      labelObj.position.copy(dir.clone().multiplyScalar(AXIS_LEN * 1.25));
      scene.add(labelObj);
    }

    // ── XY 평면(바닥) 기준 모눈종이 — 항상 원점 중심으로 깔아둬서,
    // 사용자가 평면도 그리듯 감을 잡을 수 있게 한다. PlaneGeometry는
    // 기본으로 XY 평면(법선 Z)에 원점 중심으로 놓이므로 회전이 필요 없다.
    {
      const w = mmToScene(BASE_GRID_WIDTH_MM);
      const h = mmToScene(BASE_GRID_DEPTH_MM);
      const wSeg = Math.round(BASE_GRID_WIDTH_MM / BASE_GRID_SPACING_MM);
      const hSeg = Math.round(BASE_GRID_DEPTH_MM / BASE_GRID_SPACING_MM);
      const geo = new THREE.PlaneGeometry(w, h, wSeg, hSeg);
      const mat = new THREE.MeshBasicMaterial({
        color: PENCIL_DIM,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
      });
      scene.add(new THREE.Mesh(geo, mat));
    }

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
            color: isSelectedEdge ? SELECT_COLOR : REF_EDGE,
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
          if (p.isVertex === false) continue; // 자유곡선 중간 보간점은 점으로 안 보여준다
          const isHighlighted = highlightedPointIds.has(p.id);
          const geo = new THREE.SphereGeometry(isHighlighted ? 0.05 : 0.028, 12, 12);
          const mat = new THREE.MeshBasicMaterial({
            color: isHighlighted ? SELECT_COLOR : REF_EDGE,
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
    const geo = new THREE.SphereGeometry(0.032, 12, 12);
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
  function addActiveEdgeLine(e: EdgeRec, showLabel = true) {
    const from = activePointsRef.current.get(e.fromId);
    const to = activePointsRef.current.get(e.toId);
    if (!from || !to) return;
    const geo = new THREE.BufferGeometry().setFromPoints([vecMm(from), vecMm(to)]);
    const mat = new THREE.LineBasicMaterial({ color: PENCIL });
    const line = new THREE.Line(geo, mat);
    line.userData = { kind: "edge", sketchId: activeSketchId, from, to };
    activeEdgeGroupRef.current?.add(line);
    activeEdgeLinesRef.current.set(e.id, line);

    if (!showLabel) return;
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

  // OrbitControls는 생성될 때의 camera.up(월드 Z축)을 기준으로 회전축을
  // 한 번만 계산해두고 그 뒤로 다시 읽지 않는다(three.js 소스 확인).
  // 그래서 여기서 camera.up을 평면마다 바꿔버리면 화면에 보이는 방향과
  // OrbitControls의 내부 회전 계산 기준이 어긋나서 두 손가락 회전이
  // 이상하게 멈추거나 꼬이는 문제가 생긴다. camera.up은 항상 월드 Z로
  // 고정해두고, 위치·바라보는 방향만 평면에 맞춘다.
  function snapCameraFlat(plane: PlaneData) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { origin, normal } = planeBasis(plane);
    camera.position.copy(origin.clone().add(normal.clone().multiplyScalar(FLAT_DISTANCE)));
    camera.up.set(0, 0, 1);
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
    for (const [id, p] of activePointsRef.current) {
      if (p.isVertex !== false) addActivePointMesh(id, p);
    }
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

  // "나가기"를 누르면 별도 저장 버튼 없이 현재 스케치 상태를 그대로
  // 저장하면서 나간다. (저장 버튼은 없앴고, 파일 단위 저장은 추후 상단
  // 메뉴에서 따로 만들 예정)
  async function exitSketch() {
    if (dirtyRef.current) {
      await saveCurrentSketch();
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

  // 오버뷰에서 평면을 탭하면 "선택"만 하지 않고 바로 새 스케치를
  // 만들어 그리기 모드로 들어간다 (트리에는 "Line N"으로 추가됨).
  async function handleQuickDrawOnPlane(plane: PlaneData) {
    await handleCreateSketch(plane);
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
      const plane = planes.find((p) => p.id === obj.userData.planeId);
      if (plane && !busy) handleQuickDrawOnPlane(plane);
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
  // showLabel=false면 치수 라벨을 안 붙인다 (자유곡선을 잘게 쪼갠 구간용 —
  // 30mm 단위 조각마다 치수가 다 뜨면 지저분하므로, 진짜 직선을 그을 때만 보여준다).
  // showPoint=false면 점(구슬) 표시를 안 한다 (자유곡선 중간 보간점용 —
  // 궤적을 부드럽게 유지하기 위한 점일 뿐, 실제 꼭짓점처럼 보이면 안 되므로).
  function commitDrawPoint(target: THREE.Vector3, showLabel = true, showPoint = true) {
    let pointId = findNearbyActivePoint(target);
    if (!pointId) {
      pointId = `tmp_${crypto.randomUUID()}`;
      const rec: PointRec = {
        id: pointId,
        x: sceneToMm(target.x),
        y: sceneToMm(target.y),
        z: sceneToMm(target.z),
        isVertex: showPoint,
      };
      activePointsRef.current.set(pointId, rec);
      if (showPoint) addActivePointMesh(pointId, rec);
      setPointCount(activePointsRef.current.size);
      dirtyRef.current = true;
    }

    const last = lastPointIdRef.current;
    if (last && last !== pointId) {
      const edgeId = `tmp_${crypto.randomUUID()}`;
      const rec: EdgeRec = { id: edgeId, fromId: last, toId: pointId };
      activeEdgesRef.current.set(edgeId, rec);
      addActiveEdgeLine(rec, showLabel);
      setEdgeCount(activeEdgesRef.current.size);
      dirtyRef.current = true;
    }
    lastPointIdRef.current = pointId;
    clearTypedLength();
  }

  // 격자·직교 스냅보다 "근처 기존 점에 물리는 것"을 항상 우선한다.
  // 그렇지 않으면 도형을 닫으려고 첫 점 근처를 찍었을 때 마그네틱
  // 스냅이 커서를 다른 방향으로 틀어버려서 정확히 안 물릴 수 있다.
  function commitDrawPointFromRaw(
    raw: THREE.Vector3,
    snap = true,
    showLabel = true,
    showPoint = true
  ) {
    const nearbyId = findNearbyActivePoint(raw);
    const target = nearbyId
      ? vecMm(activePointsRef.current.get(nearbyId)!)
      : snap
        ? applyOrthoSnap(applySnap(raw))
        : raw;
    commitDrawPoint(target, showLabel, showPoint);
  }

  // 자유곡선 그대로 그린 궤적을 여러 짧은 직선(점 여러 개)으로 커밋한다.
  // 궤적의 모든 점을 다 쓰면 너무 촘촘하므로 일정 거리 이상 떨어진
  // 점만 남기고, 중간 점들은 스냅을 걸지 않아 손그림 느낌을 유지한다.
  // 조각마다 치수 라벨이 뜨면 지저분하니 자유곡선 구간에는 라벨을 안 붙인다
  // (치수는 실제로 "직선으로" 그은 선에만 표시된다). 마찬가지로 중간 보간점은
  // 점 표시도 하지 않고, 스트로크의 시작/끝점만 점으로 보여준다.
  const FREEHAND_MIN_DIST = 0.03; // scene 단위 ≈ 30mm
  function commitFreehandStroke(rawPoints: THREE.Vector3[]) {
    if (rawPoints.length === 0) return;
    const simplified = [rawPoints[0]];
    for (let i = 1; i < rawPoints.length; i++) {
      if (rawPoints[i].distanceTo(simplified[simplified.length - 1]) >= FREEHAND_MIN_DIST) {
        simplified.push(rawPoints[i]);
      }
    }
    const last = rawPoints[rawPoints.length - 1];
    if (simplified[simplified.length - 1] !== last) simplified.push(last);
    simplified.forEach((p, i) => {
      const isEndpoint = i === 0 || i === simplified.length - 1;
      commitDrawPointFromRaw(p, false, false, isEndpoint);
    });
  }

  function handleDrawClick(clientX: number, clientY: number) {
    const raw = raycastToActivePlane(clientX, clientY);
    if (!raw) return;
    commitDrawPointFromRaw(raw);
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
    strokeActiveRef.current = false;
    strokeRawPointsRef.current = [];
    strokeStraightModeRef.current = false;
    clearHoldTimeout();
    hideFreehandPreview();
  }

  // 손을 움직이지 않고 HOLD_MS 이상 멈춰 있으면 그 순간부터 직선
  // 모드로 전환한다. 움직일 때마다 타이머를 다시 건다.
  const HOLD_MS = 1000;
  function clearHoldTimeout() {
    if (strokeHoldTimeoutRef.current) {
      clearTimeout(strokeHoldTimeoutRef.current);
      strokeHoldTimeoutRef.current = null;
    }
  }
  function scheduleHoldTimeout() {
    clearHoldTimeout();
    strokeHoldTimeoutRef.current = setTimeout(() => {
      strokeStraightModeRef.current = true;
      updateFreehandPreview();
    }, HOLD_MS);
  }

  // ── 손으로 그은 궤적 실시간 미리보기 (누른 채 이동할 때) ──────────
  function updateFreehandPreview() {
    const pts = strokeRawPointsRef.current;
    if (pts.length < 2) return;
    // 직선 모드로 전환됐으면 시작~현재 두 점만, 아니면 궤적 전체를 그대로.
    const renderPts = strokeStraightModeRef.current ? [pts[0], pts[pts.length - 1]] : pts;
    if (!freehandLineRef.current) {
      const geo = new THREE.BufferGeometry().setFromPoints(renderPts);
      const mat = new THREE.LineBasicMaterial({ color: PENCIL });
      const line = new THREE.Line(geo, mat);
      previewGroupRef.current?.add(line);
      freehandLineRef.current = line;
    } else {
      freehandLineRef.current.geometry.dispose();
      freehandLineRef.current.geometry = new THREE.BufferGeometry().setFromPoints(renderPts);
    }
  }
  function hideFreehandPreview() {
    if (!freehandLineRef.current) return;
    previewGroupRef.current?.remove(freehandLineRef.current);
    freehandLineRef.current.geometry.dispose();
    (freehandLineRef.current.material as THREE.Material).dispose();
    freehandLineRef.current = null;
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

  // 그리기/점 드래그 중에 손가락이 하나 더 닿으면(핀치 줌·회전 제스처)
  // 즉시 취소하고 OrbitControls의 두 손가락 제스처로 넘겨준다.
  function cancelInteractionForMultiTouch() {
    pointerDownRef.current = null;
    if (draggingPointIdRef.current) {
      draggingPointIdRef.current = null;
    }
    if (strokeActiveRef.current) {
      strokeActiveRef.current = false;
      strokeRawPointsRef.current = [];
      strokeStraightModeRef.current = false;
      clearHoldTimeout();
      hideFreehandPreview();
    }
  }

  function handlePointerCancel(e: React.PointerEvent) {
    activePointerIdsRef.current.delete(e.pointerId);
    cancelInteractionForMultiTouch();
  }

  function handlePointerDown(e: React.PointerEvent) {
    activePointerIdsRef.current.add(e.pointerId);
    if (activePointerIdsRef.current.size > 1) {
      // 두 번째 손가락 — 그리기/드래그로 취급하지 않는다.
      cancelInteractionForMultiTouch();
      return;
    }

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
    } else if (mode === "sketch" && tool === "pen" && !chainMode) {
      const raw = raycastToActivePlane(e.clientX, e.clientY);
      if (raw) {
        // 이어그리기가 꺼져 있으면 매번 새로운 독립된 선으로 시작한다 —
        // 이전 스트로크의 끝점에 자동으로 이어붙지 않도록 체인을 끊는다.
        lastPointIdRef.current = null;
        strokeActiveRef.current = true;
        strokeRawPointsRef.current = [raw.clone()];
        strokeStraightModeRef.current = straightMode;
        if (!straightMode) scheduleHoldTimeout();
        e.currentTarget.setPointerCapture(e.pointerId);
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
    activePointerIdsRef.current.delete(e.pointerId);
    if (activePointerIdsRef.current.size > 0) {
      // 아직 다른 손가락이 남아있다 (핀치/회전 제스처 도중) — 그리기로 처리하지 않는다.
      pointerDownRef.current = null;
      return;
    }

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

    if (mode === "sketch" && tool === "pen" && strokeActiveRef.current) {
      strokeActiveRef.current = false;
      clearHoldTimeout();
      const rawPoints = strokeRawPointsRef.current;
      const wasStraight = strokeStraightModeRef.current;
      strokeRawPointsRef.current = [];
      strokeStraightModeRef.current = false;
      hideFreehandPreview();
      if (rawPoints.length === 0) return;

      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) {
        // 거의 안 움직였으면 기존처럼 탭 한 번 = 점 하나
        handleDrawClick(e.clientX, e.clientY);
      } else if (wasStraight) {
        // 직선 모드(체크박스 또는 1초 멈춤으로 전환) → 시작점~끝점 직선
        commitDrawPointFromRaw(rawPoints[0]);
        commitDrawPointFromRaw(rawPoints[rawPoints.length - 1]);
      } else {
        // 자유곡선 그대로(삐뚤빼뚤 유지) → 궤적을 따라 여러 점으로 커밋
        commitFreehandStroke(rawPoints);
      }
      return;
    }

    if (!down) return;
    if (!isTap(down, { x: e.clientX, y: e.clientY })) return; // 드래그(회전)로 판단, 무시

    if (mode === "sketch") {
      if (tool === "pen" && chainMode) handleDrawClick(e.clientX, e.clientY);
      else if (tool === "move") handleActiveEdgeTap(e.clientX, e.clientY);
      return;
    }
    handleOverviewClick(e.clientX, e.clientY);
  }

  function handleCanvasMove(e: React.PointerEvent) {
    if (mode !== "sketch") return;
    if (activePointerIdsRef.current.size > 1) return; // 두 손가락 제스처 중엔 관여하지 않는다

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

    if (strokeActiveRef.current) {
      strokeRawPointsRef.current.push(raw.clone());
      // 직선 모드가 아니면 계속 움직이는 동안은 멈춤 타이머를 계속 미룬다
      // (1초 이상 안 움직이면 그때 직선 모드로 전환됨)
      if (!straightMode && !strokeStraightModeRef.current) scheduleHoldTimeout();
      updateFreehandPreview();
      setCursorMm({ x: sceneToMm(raw.x), y: sceneToMm(raw.y), z: sceneToMm(raw.z) });
      return;
    }

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

  // 별도 저장 버튼은 없고, 나가기를 누를 때 이 함수로 현재 상태를 저장한다.
  async function saveCurrentSketch() {
    if (!activeSketchId) return;
    setSaving(true);
    try {
      const pointsArr = [...activePointsRef.current.values()];
      const edgesArr = [...activeEdgesRef.current.values()].map((e) => ({
        fromId: e.fromId,
        toId: e.toId,
      }));
      await saveSketchGeometry(projectId, activeSketchId, pointsArr, edgesArr);
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
                disabled={saving}
                className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "← 나가기"}
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

              {tool === "pen" && (
                <>
                  <label
                    className="flex items-center gap-1 text-xs text-gray-500 px-1"
                    title="켜면 탭으로 점을 찍어서 잇는 기존 방식"
                  >
                    <input
                      type="checkbox"
                      checked={chainMode}
                      onChange={(e) => setChainMode(e.target.checked)}
                    />
                    이어그리기
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-gray-500 px-1"
                    title="켜면 누른 채 그은 궤적과 무관하게 항상 시작~끝 직선으로 그려짐"
                  >
                    <input
                      type="checkbox"
                      checked={straightMode}
                      disabled={chainMode}
                      onChange={(e) => setStraightMode(e.target.checked)}
                    />
                    직선으로 그리기
                  </label>
                </>
              )}

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

              {chainMode && (
                <button
                  onClick={handleNewStroke}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
                >
                  새 선 시작
                </button>
              )}
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
          onPointerCancel={handlePointerCancel}
          onPointerMove={handleCanvasMove}
          onContextMenu={handleCanvasContextMenu}
        />
      </div>
    </div>
  );
}
