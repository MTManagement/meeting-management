"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  createPlaneFromDefinition,
  createSketch,
  deleteSketch,
  ensureFreeSketch,
  saveSketchGeometry,
} from "./actions";

type Vec3 = { x: number; y: number; z: number };
type PointRec = { id: string; x: number; y: number; z: number; isVertex?: boolean };
type EdgeRec = {
  id: string;
  fromId: string;
  toId: string;
  showLabel?: boolean;
  strokeId?: string; // 한 번에 그은 선(획) 묶음 id. 같은 값끼리 한 개체로 선택·삭제
};
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
const EDGE_WIDTH_PX = 2.5; // 손그림 느낌을 위한 선 두께(화면 픽셀)
const EDGE_WIDTH_SELECTED_PX = 3.5;
const CARD_SIZE = 0.3; // scene 단위 (=300mm)
const GRID_SIZE = 10; // scene 단위 (=10m)
const BASE_GRID_WIDTH_MM = 5000; // XY 평면에 항상 깔아두는 모눈종이 크기 (가로, X)
const BASE_GRID_DEPTH_MM = 5000; // 모눈종이 크기 (세로, Y)
const BASE_GRID_SPACING_MM = 100; // 모눈 한 칸 크기
const FLAT_DISTANCE = 2.5; // 스케치 정면 뷰 카메라 거리 (scene 단위)

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

// 모눈종이를 옅은 점(dot) 격자로 그리기 위한 좌표 배열. 로컬 XY 평면
// 기준(원점 중심)으로 만들고, 실제 평면 위치/방향은 호출부에서
// position/quaternion으로 맞춘다.
function makeDotGridPositions(widthMm: number, depthMm: number, spacingMm: number): Float32Array {
  const wSeg = Math.max(1, Math.round(widthMm / spacingMm));
  const hSeg = Math.max(1, Math.round(depthMm / spacingMm));
  const w = mmToScene(widthMm);
  const h = mmToScene(depthMm);
  const positions: number[] = [];
  for (let j = 0; j <= hSeg; j++) {
    const y = -h / 2 + (j / hSeg) * h;
    for (let i = 0; i <= wSeg; i++) {
      const x = -w / 2 + (i / wSeg) * w;
      positions.push(x, y, 0);
    }
  }
  return new Float32Array(positions);
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
// 법선만 주어졌을 때 평면의 가로축(uAxis)을 정한다. Z가 위쪽이므로
// 세워진 평면은 가로축이 수평이 되게, 바닥과 평행한 평면은 X축을 쓴다.
function uAxisForNormal(n: Vec3): Vec3 {
  const normal = vecUnit(n);
  if (Math.abs(normal.z) > 0.9) return { x: 1, y: 0, z: 0 };
  const u = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
  return { x: u.x, y: u.y, z: u.z };
}
function fakePlane(origin: Vec3, normal: Vec3, uAxis: Vec3): PlaneData {
  return { id: "", label: "", origin, normal, uAxis, sketches: [] };
}

// 평면 추가 도구
// - offset: 기준 평면을 법선 방향으로 offsetMm 만큼 띄운 평행 평면.
//   throughPoint가 있으면 그 점을 지나는 평행 평면(Parallel through point).
// - normal: 선택한 선(획) 위의 한 지점에서 선과 직각인 평면(Normal to curve).
type PlaneTool =
  | { kind: "offset"; baseId: string; offsetMm: number; throughPoint: PointRec | null }
  | { kind: "normal"; sketchId: string; edgeId: string; pick: { point: Vec3; dir: Vec3 } | null };

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
function createEditableLabelDiv(
  text: string,
  onCommit: (mm: number) => void,
  allowNegative = false
) {
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
      if (!Number.isNaN(value) && (allowNegative ? true : value > 0)) onCommit(value);
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

function strokeKeyOf(e: EdgeRec) {
  return e.strokeId ?? e.id;
}
function countStrokes(edges: Iterable<EdgeRec>) {
  const keys = new Set<string>();
  for (const e of edges) keys.add(strokeKeyOf(e));
  return keys.size;
}

// 점을 화면 크기와 무관하게 항상 같은 픽셀 크기의 동그라미로 그리기
// 위한 원형 텍스처(구 메시는 확대하면 점이 거대해 보였다).
let dotTexture: THREE.Texture | null = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}
const DOT_PX = 9;
const DOT_SELECTED_PX = 14;
function makeDot(pos: THREE.Vector3, color: number, sizePx = DOT_PX) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: sizePx,
    sizeAttenuation: false,
    map: getDotTexture(),
    transparent: true,
    alphaTest: 0.5,
    depthTest: false,
  });
  const dot = new THREE.Points(geo, mat);
  dot.position.copy(pos); // 위치는 오브젝트 position으로(점 드래그 시 이것만 바꾸면 됨)
  return dot;
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

// CATIA 트리처럼 부모에서 자식으로 이어지는 가지선(├, └)을 그린다.
// guides: 조상 단계마다 세로선을 계속 이어 그릴지(그 조상이 마지막 자식이 아니면 true)
function TreeGuides({ guides, isLast }: { guides: boolean[]; isLast: boolean }) {
  return (
    <>
      {guides.map((g, i) => (
        <span key={i} className="relative w-4 shrink-0">
          {g && <span className="absolute left-1/2 top-0 bottom-0 border-l border-gray-300" />}
        </span>
      ))}
      <span className="relative w-4 shrink-0">
        <span
          className={`absolute left-1/2 top-0 border-l border-gray-300 ${isLast ? "h-1/2" : "bottom-0"}`}
        />
        <span className="absolute left-1/2 right-0 top-1/2 border-t border-gray-300" />
      </span>
    </>
  );
}

export default function ProjectCanvas({
  projectId,
  projectName,
  planes: serverPlanes,
  freeSketch: serverFreeSketch,
}: {
  projectId: string;
  projectName: string;
  planes: PlaneData[];
  freeSketch: SketchData | null;
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
  // 굵은 선(Line2)은 화면 픽셀 해상도를 알아야 제대로 된 두께로 그려진다.
  const lineResolutionRef = useRef(new THREE.Vector2(1, 1));

  const activePointMeshesRef = useRef<Map<string, THREE.Points>>(new Map());
  const activeEdgeLinesRef = useRef<Map<string, Line2>>(new Map());
  const activeEdgeLabelsRef = useRef<Map<string, CSS2DObject>>(new Map());
  const activePointsRef = useRef<Map<string, PointRec>>(new Map());
  // 실행 취소용 스냅샷 스택. 점 하나가 아니라 "동작 하나"(선 하나 긋기,
  // 점 드래그 하나, 삭제 하나 등) 단위로 직전 상태 전체를 저장해뒀다가
  // 되돌린다 — 자유곡선처럼 점이 여러 개 생기는 동작도 한 번에 되돌아가게.
  const undoStackRef = useRef<{ points: PointRec[]; edges: EdgeRec[] }[]>([]);
  const UNDO_STACK_LIMIT = 50;
  const activeEdgesRef = useRef<Map<string, EdgeRec>>(new Map());
  const lastPointIdRef = useRef<string | null>(null);
  const currentStrokeIdRef = useRef<string | null>(null);
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
  // 손가락 3개로 드래그하면 화면 이동(pan). 두 손가락은 OrbitControls가
  // 이미 확대/회전에 쓰고 있어서, 이동은 세 손가락에 배정한다.
  const pointerPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panCentroidRef = useRef<{ x: number; y: number } | null>(null);
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

  const [planeTool, setPlaneTool] = useState<PlaneTool | null>(null);
  const planeToolGroupRef = useRef<THREE.Group | null>(null);
  const arrowDragRef = useRef(false);
  const [pointCount, setPointCount] = useState(0);
  const [strokeCount, setStrokeCount] = useState(0);
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

  // 오버뷰 "선 잇기": 서로 다른 스케치의 점(끝점 등)을 골라 3D 선으로 잇는다.
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<PointRec | null>(null);
  const connectMarkerRef = useRef<THREE.Points | null>(null);
  const connectPreviewRef = useRef<THREE.Line | null>(null);

  // 트리에서 접어둔 평면 id들 (CATIA 스타일 펼치기/접기)
  const [collapsedPlaneIds, setCollapsedPlaneIds] = useState<Set<string>>(new Set());

  // ── 스케치 나가기 = 즉시 나가고, 저장은 뒤에서(백그라운드) ──────────
  // 나갈 때마다 저장이 끝날 때까지 기다리면 느려서, 방금 편집한 점/선은
  // 화면용 사본(override)으로 바로 반영하고 실제 DB 저장은 대기열에서
  // 순서대로 처리한다. 서버 데이터보다 override가 항상 우선이다.
  const [sketchOverrides, setSketchOverrides] = useState<
    Map<string, { points: PointRec[]; edges: EdgeRec[] }>
  >(new Map());
  const [pendingSaves, setPendingSaves] = useState(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [freeSketchId, setFreeSketchId] = useState<string | null>(serverFreeSketch?.id ?? null);

  const planes = useMemo(
    () =>
      serverPlanes.map((plane) => ({
        ...plane,
        sketches: plane.sketches.map((sk) => {
          const o = sketchOverrides.get(sk.id);
          return o ? { ...sk, points: o.points, edges: o.edges } : sk;
        }),
      })),
    [serverPlanes, sketchOverrides]
  );
  const freeSketch = useMemo<SketchData | null>(() => {
    const id = freeSketchId;
    if (!id) return null;
    const base = serverFreeSketch && serverFreeSketch.id === id ? serverFreeSketch : null;
    const o = sketchOverrides.get(id);
    return {
      id,
      name: base?.name ?? "3D 연결선",
      points: o?.points ?? base?.points ?? [],
      edges: o?.edges ?? base?.edges ?? [],
    };
  }, [freeSketchId, serverFreeSketch, sketchOverrides]);

  function setSketchOverride(sketchId: string, points: PointRec[], edges: EdgeRec[]) {
    setSketchOverrides((prev) => new Map(prev).set(sketchId, { points, edges }));
  }

  function queueSave(sketchId: string, points: PointRec[], edges: EdgeRec[]) {
    setPendingSaves((n) => n + 1);
    const pointsIn = points.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, isVertex: p.isVertex }));
    const edgesIn = edges.map((e) => ({ fromId: e.fromId, toId: e.toId, strokeId: e.strokeId }));
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await saveSketchGeometry(projectId, sketchId, pointsIn, edgesIn);
      } catch (err) {
        console.error(err);
        alert("스케치 저장에 실패했습니다. 네트워크 상태를 확인해주세요.");
      } finally {
        setPendingSaves((n) => n - 1);
      }
    });
  }

  // 저장이 아직 끝나지 않았는데 페이지를 닫으려 하면 경고한다.
  useEffect(() => {
    if (pendingSaves <= 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingSaves]);

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
    camera.position.set(1.9, 2.5, 1.6);
    camera.up.set(0, 0, 1); // Z축을 상하(수직) 방향으로 사용
    cameraRef.current = camera;
    lineResolutionRef.current.set(mount.clientWidth, mount.clientHeight);

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
    const AXIS_LEN = mmToScene(200);
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
    // 사용자가 평면도 그리듯 감을 잡을 수 있게 한다. 스케치 종이 느낌을
    // 살리려고 선 격자 대신 옅은 점(dot) 격자로 그린다. 원점 중심 XY
    // 평면 배치이므로 회전이 필요 없다.
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          makeDotGridPositions(BASE_GRID_WIDTH_MM, BASE_GRID_DEPTH_MM, BASE_GRID_SPACING_MM),
          3
        )
      );
      const mat = new THREE.PointsMaterial({
        color: PENCIL_DIM,
        size: 3,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.7,
      });
      scene.add(new THREE.Points(geo, mat));
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
    const planeToolGroup = new THREE.Group();
    scene.add(planeToolGroup);
    planeToolGroupRef.current = planeToolGroup;
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
      lineResolutionRef.current.set(mount.clientWidth, mount.clientHeight);
      // 이미 만들어진 굵은 선(Line2)들도 새 해상도를 반영해야 두께가
      // 화면 회전/크기 변경 후에도 정확하게 유지된다.
      const existingLines = [
        ...(activeEdgeGroupRef.current?.children ?? []),
        ...(refGeometryGroupRef.current?.children ?? []),
      ];
      for (const child of existingLines) {
        if (child instanceof Line2) {
          child.material.resolution.copy(lineResolutionRef.current);
        }
      }
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

      for (const sketch of plane.sketches) renderRefSketch(sketch);
    }
    if (freeSketch) renderRefSketch(freeSketch);

    function renderRefSketch(sketch: SketchData) {
      if (!refGroup) return;
      if (mode === "sketch" && sketch.id === activeSketchId) return; // 활성 스케치는 별도 그룹에서 그림
      const pointById = new Map(sketch.points.map((p) => [p.id, p]));
      // 오버뷰에서 선을 하나 탭하면 그 선이 속한 획 전체를 강조한다.
      let selKey: string | null = null;
      if (selectedEdge?.sketchId === sketch.id) {
        const se = sketch.edges.find((e) => e.id === selectedEdge.edgeId);
        if (se) selKey = strokeKeyOf(se);
      }
      const highlightedPointIds = new Set<string>();

      for (const e of sketch.edges) {
        const from = pointById.get(e.fromId);
        const to = pointById.get(e.toId);
        if (!from || !to) continue;
        const isSelectedEdge = selKey !== null && strokeKeyOf(e) === selKey;
        if (isSelectedEdge) {
          highlightedPointIds.add(from.id);
          highlightedPointIds.add(to.id);
        }
        const line = makeFatLine(
          [vecMm(from), vecMm(to)],
          isSelectedEdge ? SELECT_COLOR : REF_EDGE,
          isSelectedEdge ? EDGE_WIDTH_SELECTED_PX : EDGE_WIDTH_PX
        );
        line.userData = { kind: "edge", edgeId: e.id, sketchId: sketch.id, from, to };
        refGroup.add(line);
      }

      for (const p of sketch.points) {
        if (p.isVertex === false) continue; // 자유곡선/드래그 선의 점은 점으로 안 보여준다
        const isHighlighted = highlightedPointIds.has(p.id);
        refGroup.add(
          makeDot(vecMm(p), isHighlighted ? SELECT_COLOR : REF_EDGE, isHighlighted ? DOT_SELECTED_PX : 7)
        );
      }
    }
  }, [planes, freeSketch, activePlaneId, activeSketchId, mode, selectedPlaneId, selectedEdge]);

  // 손그림 느낌을 살리려고 선을 두껍게(화면 픽셀 기준) 그린다. 일반
  // THREE.Line의 linewidth는 대부분 브라우저(크롬 등)에서 무시되기
  // 때문에, 실제로 두께가 반영되는 Line2(three.js fat-lines)를 쓴다.
  function makeFatLine(points: THREE.Vector3[], color: number, widthPx: number): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color,
      linewidth: widthPx,
      resolution: lineResolutionRef.current,
    });
    return new Line2(geo, mat);
  }
  function updateFatLinePositions(line: Line2, points: THREE.Vector3[]) {
    line.geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  }

  // ── 활성 스케치용 점/선 메시 헬퍼 ──────────────────────────────
  function addActivePointMesh(id: string, p: PointRec) {
    const mesh = makeDot(vecMm(p), PENCIL);
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
    const line = makeFatLine([vecMm(from), vecMm(to)], PENCIL, EDGE_WIDTH_PX);
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
        const fromVec = vecMm(from);
        const toVec = vecMm(to);
        updateFatLinePositions(line, [fromVec, toVec]);
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

  // 상태바 표시용 개수. 선은 획(한 번에 그은 선) 단위, 점은 화면에
  // 보이는 꼭짓점만 센다(자유곡선 내부 보간점 제외).
  function syncCounts() {
    let vertices = 0;
    for (const p of activePointsRef.current.values()) if (p.isVertex !== false) vertices++;
    setPointCount(vertices);
    setStrokeCount(countStrokes(activeEdgesRef.current.values()));
  }

  // 지금 그려진 점/선 상태를 실행 취소 스택에 저장해둔다. 실제로 뭔가를
  // 바꾸는 동작(선 긋기, 점 드래그, 삭제 등) 직전에 호출한다.
  function pushUndoSnapshot() {
    const points = [...activePointsRef.current.values()].map((p) => ({ ...p }));
    const edges = [...activeEdgesRef.current.values()].map((e) => ({ ...e }));
    undoStackRef.current.push({ points, edges });
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
  }

  function handleUndo() {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    hideDrawPreview();
    clearActiveGeometry();
    for (const p of snap.points) {
      activePointsRef.current.set(p.id, p);
      if (p.isVertex !== false) addActivePointMesh(p.id, p);
    }
    for (const e of snap.edges) {
      activeEdgesRef.current.set(e.id, e);
      addActiveEdgeLine(e, e.showLabel ?? true);
    }
    syncCounts();
    dirtyRef.current = true;
    selectActivePoint(null);
  }

  // ── 스케치 진입 시 그리드 + 카메라 정면 뷰 ─────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const gridGroup = gridGroupRef.current;
    if (!scene || !gridGroup) return;

    while (gridGroup.children.length) {
      const obj = gridGroup.children.pop() as THREE.Points;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }

    if (mode !== "sketch" || !activePlane) return;

    const gridSizeMm = GRID_SIZE * MM_PER_SCENE_UNIT;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        makeDotGridPositions(gridSizeMm, gridSizeMm, BASE_GRID_SPACING_MM),
        3
      )
    );
    const mat = new THREE.PointsMaterial({
      color: PENCIL_DIM,
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.6,
    });
    const points = new THREE.Points(geo, mat);
    const { origin } = planeBasis(activePlane);
    points.position.copy(origin);
    points.quaternion.copy(planeQuaternion(activePlane));
    gridGroup.add(points);
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
    stopConnect();
    setPlaneTool(null);
    clearActiveGeometry();
    undoStackRef.current = [];
    for (const p of sketch.points) activePointsRef.current.set(p.id, p);
    for (const e of sketch.edges) activeEdgesRef.current.set(e.id, e);
    for (const [id, p] of activePointsRef.current) {
      if (p.isVertex !== false) addActivePointMesh(id, p);
    }
    // DB에는 "치수 라벨 표시 여부"가 없어서 다시 열 때 추정한다:
    // 선분 하나짜리 획(직선) 또는 양끝이 보이는 꼭짓점인 선(이어그리기)만 라벨 표시,
    // 자유곡선(여러 선분 + 숨은 보간점)은 라벨 없음.
    const strokeSizes = new Map<string, number>();
    for (const e of activeEdgesRef.current.values()) {
      const k = strokeKeyOf(e);
      strokeSizes.set(k, (strokeSizes.get(k) ?? 0) + 1);
    }
    for (const [, e] of activeEdgesRef.current) {
      if (e.showLabel === undefined) {
        const from = activePointsRef.current.get(e.fromId);
        const to = activePointsRef.current.get(e.toId);
        const single = (strokeSizes.get(strokeKeyOf(e)) ?? 1) === 1;
        const visibleEnds = from?.isVertex !== false && to?.isVertex !== false;
        e.showLabel = single || visibleEnds;
      }
      addActiveEdgeLine(e, e.showLabel);
    }
    syncCounts();
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

  // "나가기"는 저장을 기다리지 않고 바로 나간다. 편집한 내용은 화면용
  // 사본으로 즉시 반영하고, 실제 DB 저장은 뒤에서 대기열로 처리한다.
  function exitSketch() {
    if (activeSketchId && dirtyRef.current) {
      const points = [...activePointsRef.current.values()].map((p) => ({ ...p }));
      const edges = [...activeEdgesRef.current.values()].map((e) => ({ ...e }));
      setSketchOverride(activeSketchId, points, edges);
      queueSave(activeSketchId, points, edges);
      dirtyRef.current = false;
    }
    clearActiveGeometry();
    undoStackRef.current = [];
    hideDrawPreview();
    draggingPointIdRef.current = null;
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    setActivePlaneId(null);
    setActiveSketchId(null);
    setMode("overview");
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
      await saveQueueRef.current; // 이 스케치 저장이 대기 중이면 끝난 뒤 삭제
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

  // ── 스케치 안: 선택한 선의 끝점에서 그 선에 수직인 평면 ────────
  async function handleCreatePerpPlane(point: PointRec) {
    if (!pendingPerpEdge) return;
    setBusy(true);
    try {
      const normal = {
        x: pendingPerpEdge.to.x - pendingPerpEdge.from.x,
        y: pendingPerpEdge.to.y - pendingPerpEdge.from.y,
        z: pendingPerpEdge.to.z - pendingPerpEdge.from.z,
      };
      await createPlaneFromDefinition(projectId, {
        origin: { x: point.x, y: point.y, z: point.z },
        normal,
        uAxis: uAxisForNormal(normal),
      });
      setPendingPerpEdge(null);
      setSelectedEdge(null);
      setSelectedActiveEdgeId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── 오버뷰: 평면 추가 도구 ─────────────────────────────────────
  // 미리보기 평면(원점 mm·법선·가로축)과 표시할 오프셋 치수를 계산한다.
  function planeToolPreview(tool: PlaneTool | null) {
    if (!tool) return null;
    if (tool.kind === "offset") {
      const base = planes.find((p) => p.id === tool.baseId);
      if (!base) return null;
      const n = vecUnit(base.normal);
      let origin: Vec3;
      let offsetMm: number;
      if (tool.throughPoint) {
        const tp = tool.throughPoint;
        origin = { x: tp.x, y: tp.y, z: tp.z };
        offsetMm = Math.round(
          (tp.x - base.origin.x) * n.x + (tp.y - base.origin.y) * n.y + (tp.z - base.origin.z) * n.z
        );
      } else {
        offsetMm = tool.offsetMm;
        origin = {
          x: base.origin.x + n.x * offsetMm,
          y: base.origin.y + n.y * offsetMm,
          z: base.origin.z + n.z * offsetMm,
        };
      }
      return { base, origin, normal: base.normal, uAxis: base.uAxis, offsetMm };
    }
    if (!tool.pick) return null;
    return {
      base: null,
      origin: tool.pick.point,
      normal: tool.pick.dir,
      uAxis: uAxisForNormal(tool.pick.dir),
      offsetMm: 0,
    };
  }

  function startPlaneTool() {
    stopConnect();
    if (selectedPlaneId) {
      setPlaneTool({ kind: "offset", baseId: selectedPlaneId, offsetMm: 200, throughPoint: null });
    } else if (selectedEdge) {
      setPlaneTool({
        kind: "normal",
        sketchId: selectedEdge.sketchId,
        edgeId: selectedEdge.edgeId,
        pick: null,
      });
    }
  }

  function cancelPlaneTool() {
    setPlaneTool(null);
    arrowDragRef.current = false;
  }

  async function applyPlaneTool() {
    const tool = planeTool;
    const pv = planeToolPreview(tool);
    if (!tool || !pv) return;
    if (tool.kind === "offset" && !tool.throughPoint && pv.offsetMm === 0) return;
    let label: string | undefined;
    if (tool.kind === "offset" && pv.base) {
      label = tool.throughPoint
        ? `${pv.base.label} 평행(점)`
        : `${pv.base.label}${pv.offsetMm >= 0 ? "+" : ""}${pv.offsetMm}mm`;
    }
    setBusy(true);
    try {
      await createPlaneFromDefinition(projectId, {
        label,
        origin: pv.origin,
        normal: pv.normal,
        uAxis: pv.uAxis,
      });
      setPlaneTool(null);
      setSelectedPlaneId(null);
      setSelectedEdge(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // 화면 좌표 → 카메라 광선
  function screenRay(clientX: number, clientY: number): THREE.Ray | null {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera) return null;
    const rect = mount.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    return raycaster.ray;
  }
  function toScreen(v: THREE.Vector3): { x: number; y: number } | null {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera) return null;
    const rect = mount.getBoundingClientRect();
    const p = v.clone().project(camera);
    if (p.z > 1) return null;
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }
  function distToSegment2D(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return { dist: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
  }

  const PLANE_ARROW_LEN = mmToScene(250);
  // 오프셋 화살표 근처를 눌렀는지(화면 기준 24px 이내)
  function isNearOffsetArrow(clientX: number, clientY: number) {
    const pv = planeToolPreview(planeTool);
    if (!pv || planeTool?.kind !== "offset") return false;
    const start = vecMm(pv.origin);
    const tip = start.clone().add(vecUnit(pv.normal).multiplyScalar(PLANE_ARROW_LEN));
    const a = toScreen(start);
    const b = toScreen(tip);
    if (!a || !b) return false;
    return distToSegment2D({ x: clientX, y: clientY }, a, b).dist < 24;
  }

  // 화살표를 끄는 동안: 포인터 광선과 기준 평면의 법선 직선 사이의 가장
  // 가까운 지점을 구해 오프셋 거리로 쓴다(10mm 단위로 맞춤).
  function dragOffsetArrow(clientX: number, clientY: number) {
    if (planeTool?.kind !== "offset") return;
    const base = planes.find((p) => p.id === planeTool.baseId);
    const ray = screenRay(clientX, clientY);
    if (!base || !ray) return;
    const o = vecMm(base.origin);
    const n = vecUnit(base.normal);
    const d = ray.direction;
    const w0 = o.clone().sub(ray.origin);
    const b = n.dot(d);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return; // 법선 방향을 정면으로 보고 있으면 계산 불가
    const t = (b * d.dot(w0) - n.dot(w0)) / denom;
    const offsetMm = Math.round(sceneToMm(t) / 10) * 10;
    setPlaneTool({ ...planeTool, offsetMm, throughPoint: null });
  }

  function handlePlaneToolTap(clientX: number, clientY: number) {
    if (!planeTool) return;
    if (planeTool.kind === "offset") {
      // 기존 점을 탭하면 그 점을 지나는 평행 평면으로 바뀐다
      const hit = pickScreenPoint(clientX, clientY);
      if (hit) setPlaneTool({ ...planeTool, throughPoint: hit });
      return;
    }
    // 선에 수직: 선택한 획의 선분들 중 탭 위치와 가장 가까운 곳
    const sk = getSketchData(planeTool.sketchId);
    const target = sk?.edges.find((e) => e.id === planeTool.edgeId);
    if (!sk || !target) return;
    const key = strokeKeyOf(target);
    const byId = new Map(sk.points.map((p) => [p.id, p]));
    let best: { point: Vec3; dir: Vec3; dist: number } | null = null;
    for (const e of sk.edges) {
      if (strokeKeyOf(e) !== key) continue;
      const from = byId.get(e.fromId);
      const to = byId.get(e.toId);
      if (!from || !to) continue;
      const a = toScreen(vecMm(from));
      const b = toScreen(vecMm(to));
      if (!a || !b) continue;
      const { dist, t } = distToSegment2D({ x: clientX, y: clientY }, a, b);
      if (dist > 30 || (best && dist >= best.dist)) continue;
      best = {
        point: {
          x: Math.round(from.x + (to.x - from.x) * t),
          y: Math.round(from.y + (to.y - from.y) * t),
          z: Math.round(from.z + (to.z - from.z) * t),
        },
        dir: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
        dist,
      };
    }
    if (best) setPlaneTool({ ...planeTool, pick: { point: best.point, dir: best.dir } });
  }

  // 미리보기(주황 평면 + 오프셋 화살표 + 치수) 그리기
  useEffect(() => {
    const group = planeToolGroupRef.current;
    if (!group) return;
    for (const obj of [...group.children]) {
      group.remove(obj); // remove()여야 CSS2D 치수 라벨의 DOM도 같이 사라진다
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    if (mode !== "overview") return;
    const pv = planeToolPreview(planeTool);
    if (!pv) return;
    const fp = fakePlane(pv.origin, pv.normal, pv.uAxis);
    const origin = vecMm(pv.origin);
    const quat = planeQuaternion(fp);

    const size = CARD_SIZE * 1.4;
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        color: SELECT_COLOR,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    card.position.copy(origin);
    card.quaternion.copy(quat);
    group.add(card);
    const h = size / 2;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h, -h, 0),
        new THREE.Vector3(h, -h, 0),
        new THREE.Vector3(h, h, 0),
        new THREE.Vector3(-h, h, 0),
      ]),
      new THREE.LineBasicMaterial({ color: SELECT_COLOR })
    );
    outline.position.copy(origin);
    outline.quaternion.copy(quat);
    group.add(outline);

    if (planeTool?.kind === "offset" && pv.base) {
      const n = vecUnit(pv.normal);
      const arrow = new THREE.ArrowHelper(
        n,
        origin,
        PLANE_ARROW_LEN,
        SELECT_COLOR,
        PLANE_ARROW_LEN * 0.22,
        PLANE_ARROW_LEN * 0.12
      );
      group.add(arrow);
      // 기준 평면 원점 → 새 평면 원점 점선(띄운 거리 표시)
      const baseOrigin = vecMm(pv.base.origin);
      if (baseOrigin.distanceTo(origin) > 1e-6) {
        const link = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([baseOrigin, origin]),
          new THREE.LineDashedMaterial({ color: SELECT_COLOR, dashSize: 0.03, gapSize: 0.02 })
        );
        link.computeLineDistances();
        group.add(link);
      }
      const labelDiv = createEditableLabelDiv(
        `${pv.offsetMm}mm`,
        (mm) => {
          setPlaneTool((prev) =>
            prev && prev.kind === "offset" ? { ...prev, offsetMm: Math.round(mm), throughPoint: null } : prev
          );
        },
        true
      );
      labelDiv.style.borderColor = "#c2410c";
      const label = new CSS2DObject(labelDiv);
      label.position.copy(origin.clone().add(n.clone().multiplyScalar(PLANE_ARROW_LEN * 1.25)));
      group.add(label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planeTool, planes, mode]);

  // ── 오버뷰: 선 잇기 / 선 지우기 ────────────────────────────────
  function getSketchData(sketchId: string): SketchData | null {
    if (freeSketch && freeSketch.id === sketchId) return freeSketch;
    for (const pl of planes) {
      const sk = pl.sketches.find((x) => x.id === sketchId);
      if (sk) return sk;
    }
    return null;
  }

  // 화면 좌표 기준으로 가장 가까운 점(모든 스케치 + 3D 연결선)을 찾는다.
  // 점 표시가 안 되는 선의 끝점/곡선 위 점도 모두 후보다.
  function pickScreenPoint(clientX: number, clientY: number, maxPx = 24): PointRec | null {
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!mount || !camera) return null;
    const rect = mount.getBoundingClientRect();
    const all: PointRec[] = [
      ...planes.flatMap((pl) => pl.sketches.flatMap((sk) => sk.points)),
      ...(freeSketch?.points ?? []),
    ];
    let best: PointRec | null = null;
    let bestD = maxPx;
    const v = new THREE.Vector3();
    for (const p of all) {
      v.copy(vecMm(p)).project(camera);
      if (v.z > 1) continue; // 카메라 뒤
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function clearConnectPreview() {
    const line = connectPreviewRef.current;
    if (!line) return;
    previewGroupRef.current?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    connectPreviewRef.current = null;
  }

  function updateConnectPreview(clientX: number, clientY: number) {
    const from = connectFrom;
    const mount = mountRef.current;
    const camera = cameraRef.current;
    if (!from || !mount || !camera) return;
    const fromVec = vecMm(from);
    const snap = pickScreenPoint(clientX, clientY);
    let target: THREE.Vector3 | null = snap ? vecMm(snap) : null;
    if (!target) {
      // 스냅할 점이 없으면 시작점을 지나고 화면을 향한 평면 위로 투영
      const rect = mount.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, fromVec);
      target = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    }
    if (!target) return;
    if (!connectPreviewRef.current) {
      const geo = new THREE.BufferGeometry().setFromPoints([fromVec, target]);
      const mat = new THREE.LineDashedMaterial({ color: SELECT_COLOR, dashSize: 0.04, gapSize: 0.03 });
      const line = new THREE.Line(geo, mat);
      previewGroupRef.current?.add(line);
      connectPreviewRef.current = line;
    } else {
      connectPreviewRef.current.geometry.setFromPoints([fromVec, target]);
    }
    connectPreviewRef.current.computeLineDistances();
  }

  // 선 잇기 시작점 표시(주황 점)
  useEffect(() => {
    const group = previewGroupRef.current;
    if (connectMarkerRef.current) {
      group?.remove(connectMarkerRef.current);
      connectMarkerRef.current.geometry.dispose();
      (connectMarkerRef.current.material as THREE.Material).dispose();
      connectMarkerRef.current = null;
    }
    if (!connectFrom || mode !== "overview" || !connectMode || !group) return;
    const marker = makeDot(vecMm(connectFrom), SELECT_COLOR, DOT_SELECTED_PX);
    group.add(marker);
    connectMarkerRef.current = marker;
  }, [connectFrom, connectMode, mode]);

  function stopConnect() {
    setConnectMode(false);
    setConnectFrom(null);
    clearConnectPreview();
  }

  async function handleConnectTap(clientX: number, clientY: number) {
    const from = connectFrom;
    const hit = pickScreenPoint(clientX, clientY);
    if (!hit) {
      // 점이 아닌 곳을 탭하면 잇던 시작점은 취소하고, 선 위라면 그 선을 선택한다
      // (선 잇기를 켜둔 채로도 선택·지우기가 되게).
      setConnectFrom(null);
      clearConnectPreview();
      if (!from) handleOverviewClick(clientX, clientY, false);
      return;
    }
    if (!from) {
      setSelectedEdge(null);
      setConnectFrom(hit);
      return;
    }
    if (Math.hypot(hit.x - from.x, hit.y - from.y, hit.z - from.z) < 1) return;

    let sketchId = freeSketchId;
    if (!sketchId) {
      setBusy(true);
      try {
        const created = await ensureFreeSketch(projectId);
        sketchId = created.id;
        setFreeSketchId(created.id);
      } finally {
        setBusy(false);
      }
    }
    const base = freeSketch && freeSketch.id === sketchId ? freeSketch : null;
    const points = [...(base?.points ?? [])];
    const edges = [...(base?.edges ?? [])];
    const findOrAdd = (p: PointRec) => {
      const same = points.find((q) => q.x === p.x && q.y === p.y && q.z === p.z);
      if (same) return same.id;
      const id = `tmp_${crypto.randomUUID()}`;
      points.push({ id, x: p.x, y: p.y, z: p.z, isVertex: true });
      return id;
    };
    const fromId = findOrAdd(from);
    const toId = findOrAdd(hit);
    edges.push({ id: `tmp_${crypto.randomUUID()}`, fromId, toId, strokeId: crypto.randomUUID() });
    pushOverviewUndo(sketchId, base?.points ?? [], base?.edges ?? []);
    setSketchOverride(sketchId, points, edges);
    queueSave(sketchId, points, edges);
    // 스케치의 기본 그리기처럼 선 하나씩: 두 점을 이으면 끝, 다음 선은 새로 시작
    setConnectFrom(null);
    clearConnectPreview();
  }

  // 오버뷰에서 한 동작(선 잇기, 선 지우기)의 직전 상태를 저장해뒀다가
  // 실행 취소 시 그 스케치를 통째로 되돌린다.
  const overviewUndoRef = useRef<{ sketchId: string; points: PointRec[]; edges: EdgeRec[] }[]>([]);
  const [overviewUndoCount, setOverviewUndoCount] = useState(0);
  function pushOverviewUndo(sketchId: string, points: PointRec[], edges: EdgeRec[]) {
    overviewUndoRef.current.push({ sketchId, points: [...points], edges: [...edges] });
    if (overviewUndoRef.current.length > UNDO_STACK_LIMIT) overviewUndoRef.current.shift();
    setOverviewUndoCount(overviewUndoRef.current.length);
  }
  function handleOverviewUndo() {
    const snap = overviewUndoRef.current.pop();
    setOverviewUndoCount(overviewUndoRef.current.length);
    if (!snap) return;
    setSketchOverride(snap.sketchId, snap.points, snap.edges);
    queueSave(snap.sketchId, snap.points, snap.edges);
    setSelectedEdge(null);
    setConnectFrom(null);
    clearConnectPreview();
  }

  // 오버뷰에서 선택한 선이 속한 획 전체를 지운다(어느 스케치든).
  function deleteStrokeInSketch(sketchId: string, edgeId: string) {
    const sk = getSketchData(sketchId);
    if (!sk) return;
    const target = sk.edges.find((e) => e.id === edgeId);
    if (!target) return;
    const key = strokeKeyOf(target);
    const edges = sk.edges.filter((e) => strokeKeyOf(e) !== key);
    const used = new Set(edges.flatMap((e) => [e.fromId, e.toId]));
    const removedEnds = new Set(
      sk.edges.filter((e) => strokeKeyOf(e) === key).flatMap((e) => [e.fromId, e.toId])
    );
    const points = sk.points.filter((p) => used.has(p.id) || !removedEnds.has(p.id));
    pushOverviewUndo(sketchId, sk.points, sk.edges);
    setSketchOverride(sketchId, points, edges);
    queueSave(sketchId, points, edges);
    setSelectedEdge(null);
  }

  // ── 오버뷰 모드: 평면 카드/선 클릭으로 선택 ────────────────────
  function handleOverviewClick(clientX: number, clientY: number, allowPlane = true) {
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
    // 굵은 선(Line2)은 기본 판정 폭이 선 두께(2.5px)뿐이라 손가락으로는
    // 거의 못 짚는다. 앞뒤로 넉넉히 여유를 준다(px).
    (raycaster.params as Record<string, unknown>).Line2 = { threshold: 18 };
    raycaster.setFromCamera(mouse, camera);

    const targets = [
      ...(planeCardGroupRef.current?.children ?? []),
      ...(refGeometryGroupRef.current?.children ?? []),
    ].filter((o) => !(o instanceof THREE.Points));
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      setSelectedPlaneId(null);
      setSelectedEdge(null);
      return;
    }
    // 선이 평면 카드 위를 지나가도 선이 먼저 선택되게 한다
    // (카드가 먼저 잡히면 선 대신 새 스케치가 만들어져 버렸다).
    const edgeHit = hits.find((h) => h.object.userData.kind === "edge");
    const obj = (edgeHit ?? hits[0]).object;
    if (obj.userData.kind === "plane") {
      setSelectedEdge(null);
      if (!allowPlane) return;
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

  // 탭/직선 끝점은 손가락으로 "도형 닫기"를 정확히 못 짚어도 붙게
  // 반경을 넉넉히(180mm) 잡는다. 자유곡선 내부 점은 훨씬 촘촘하게
  // 샘플링되므로 같은 반경을 쓰면 곡선이 자기 자신과 계속 병합돼서
  // 각지게 보인다 — 그래서 자유곡선 구간에는 훨씬 좁은 반경(3mm)을 쓴다.
  const NEARBY_POINT_THRESHOLD = 0.18; // scene 단위 ≈ 180mm
  const FREEHAND_NEARBY_THRESHOLD = 0.003; // scene 단위 ≈ 3mm

  function findNearbyActivePoint(
    pos: THREE.Vector3,
    threshold = NEARBY_POINT_THRESHOLD,
    vertexOnly = false
  ): string | null {
    let best: string | null = null;
    let bestDist = threshold;
    for (const [id, p] of activePointsRef.current) {
      if (vertexOnly && p.isVertex === false) continue;
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
  function commitDrawPoint(
    target: THREE.Vector3,
    showLabel = true,
    showPoint = true,
    nearbyThreshold = NEARBY_POINT_THRESHOLD
  ) {
    // 이어지는 선이 없는 상태(새 선의 시작)면 새 획 id를 만든다.
    if (!lastPointIdRef.current) currentStrokeIdRef.current = crypto.randomUUID();
    let pointId = findNearbyActivePoint(target, nearbyThreshold);
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
      syncCounts();
      dirtyRef.current = true;
    }

    const last = lastPointIdRef.current;
    if (last && last !== pointId) {
      const edgeId = `tmp_${crypto.randomUUID()}`;
      const rec: EdgeRec = {
        id: edgeId,
        fromId: last,
        toId: pointId,
        showLabel,
        strokeId: currentStrokeIdRef.current ?? undefined,
      };
      activeEdgesRef.current.set(edgeId, rec);
      addActiveEdgeLine(rec, showLabel);
      syncCounts();
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
    showPoint = true,
    nearbyThreshold = NEARBY_POINT_THRESHOLD
  ) {
    const nearbyId = findNearbyActivePoint(raw, nearbyThreshold);
    const target = nearbyId
      ? vecMm(activePointsRef.current.get(nearbyId)!)
      : snap
        ? applyOrthoSnap(applySnap(raw))
        : raw;
    commitDrawPoint(target, showLabel, showPoint, nearbyThreshold);
  }

  // 자유곡선 그대로 그린 궤적을 여러 짧은 직선(점 여러 개)으로 커밋한다.
  // 1mm 이상 떨어진 점만 남겨서 곡선의 세밀한 모양을 최대한 유지한다.
  // "근처 점에 붙는" 반경도 3mm로 훨씬 좁게 써서, 구불구불한 곡선이
  // 자기 자신과 가까워지는 구간(예: S자)에서 엉뚱하게 이전 점에
  // 달라붙어 각지게 보이는 문제를 막는다 (탭/직선 닫기용 180mm 반경과는
  // 별개). 조각마다 치수 라벨이 뜨면 지저분하니 라벨도 안 붙인다
  // (치수는 실제로 "직선으로" 그은 선에만 표시된다). 점도 하나도 안
  // 보여준다(시작/끝점 포함) — 손그림 느낌에는 점이 어울리지 않는다.
  const FREEHAND_MIN_DIST = 0.001; // scene 단위 ≈ 1mm
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
    for (const p of simplified) {
      commitDrawPointFromRaw(p, false, false, false, FREEHAND_NEARBY_THRESHOLD);
    }
  }

  function handleDrawClick(clientX: number, clientY: number) {
    const raw = raycastToActivePlane(clientX, clientY);
    if (!raw) return;
    pushUndoSnapshot();
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
        pushUndoSnapshot();
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
      const mat = mesh.material as THREE.PointsMaterial;
      mat.color.set(isSel ? SELECT_COLOR : PENCIL);
      mat.size = isSel ? DOT_SELECTED_PX : DOT_PX;
    }
    // 선을 하나 탭해도 그 선이 속한 획 전체를 함께 강조한다.
    const selEdge = edgeId ? activeEdgesRef.current.get(edgeId) : undefined;
    const selKey = selEdge ? strokeKeyOf(selEdge) : null;
    for (const [id, line] of activeEdgeLinesRef.current) {
      const e = activeEdgesRef.current.get(id);
      const isSel = selKey !== null && !!e && strokeKeyOf(e) === selKey;
      line.material.color.set(isSel ? SELECT_COLOR : PENCIL);
      line.material.linewidth = isSel ? EDGE_WIDTH_SELECTED_PX : EDGE_WIDTH_PX;
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
  // 선택한 개체 지우기. 점이 선택돼 있으면 그 점과 연결된 선을, 선이
  // 선택돼 있으면 그 선이 속한 획(한 번에 그은 선) 전체를 지운다.
  // 지운 선 때문에 아무 데도 연결되지 않게 된 점도 같이 정리한다.
  function handleDeleteSelection() {
    if (!selectedPointId && !selectedActiveEdgeId) return;
    pushUndoSnapshot();
    const touchedPointIds = new Set<string>();
    if (selectedPointId) {
      const id = selectedPointId;
      for (const [eid, e] of [...activeEdgesRef.current]) {
        if (e.fromId !== id && e.toId !== id) continue;
        touchedPointIds.add(e.fromId);
        touchedPointIds.add(e.toId);
        removeActiveEdgeLine(eid);
        activeEdgesRef.current.delete(eid);
      }
      removeActivePointMesh(id);
      activePointsRef.current.delete(id);
      touchedPointIds.delete(id);
    } else if (selectedActiveEdgeId) {
      const target = activeEdgesRef.current.get(selectedActiveEdgeId);
      if (target) {
        const key = strokeKeyOf(target);
        for (const [eid, e] of [...activeEdgesRef.current]) {
          if (strokeKeyOf(e) !== key) continue;
          touchedPointIds.add(e.fromId);
          touchedPointIds.add(e.toId);
          removeActiveEdgeLine(eid);
          activeEdgesRef.current.delete(eid);
        }
      }
    }
    for (const pid of touchedPointIds) {
      const stillUsed = [...activeEdgesRef.current.values()].some(
        (e) => e.fromId === pid || e.toId === pid
      );
      if (stillUsed) continue;
      removeActivePointMesh(pid);
      activePointsRef.current.delete(pid);
    }
    if (lastPointIdRef.current && !activePointsRef.current.has(lastPointIdRef.current)) {
      lastPointIdRef.current = null;
    }
    syncCounts();
    dirtyRef.current = true;
    selectActivePoint(null);
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
    arrowDragRef.current = false;
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

  // 오빗컨트롤(OrbitControls)의 pan()과 같은 방식으로, 화면 픽셀 이동량을
  // 카메라 시야각·거리 기준의 월드 공간 이동량으로 바꿔 타겟과 카메라
  // 위치를 함께 옮긴다(둘을 같이 옮기면 바라보는 방향은 그대로 유지된다).
  function panCamera(deltaXPx: number, deltaYPx: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const mount = mountRef.current;
    if (!camera || !controls || !mount) return;

    const offset = camera.position.clone().sub(controls.target);
    const targetDistance = offset.length() * Math.tan((camera.fov / 2) * (Math.PI / 180));
    const factor = (2 * targetDistance) / mount.clientHeight;

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const worldDelta = right
      .multiplyScalar(-deltaXPx * factor)
      .add(up.multiplyScalar(deltaYPx * factor));

    camera.position.add(worldDelta);
    controls.target.add(worldDelta);
    controls.update();
  }

  function threeFingerPanCentroid(): { x: number; y: number } | null {
    if (activePointerIdsRef.current.size !== 3) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const id of activePointerIdsRef.current) {
      const p = pointerPositionsRef.current.get(id);
      if (!p) return null;
      sx += p.x;
      sy += p.y;
      n++;
    }
    if (n !== 3) return null;
    return { x: sx / n, y: sy / n };
  }

  function handlePointerCancel(e: React.PointerEvent) {
    activePointerIdsRef.current.delete(e.pointerId);
    pointerPositionsRef.current.delete(e.pointerId);
    if (activePointerIdsRef.current.size !== 3) panCentroidRef.current = null;
    cancelInteractionForMultiTouch();
  }

  function handlePointerDown(e: React.PointerEvent) {
    // 마우스 가운데(회전)/오른쪽(이동) 버튼은 화면 조작 전용 — 점·선을
    // 잡거나 선택하면 안 된다. 왼쪽 버튼(0)만 그리기/선택에 쓴다.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerPositionsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    activePointerIdsRef.current.add(e.pointerId);
    if (activePointerIdsRef.current.size !== 3) panCentroidRef.current = null;
    if (activePointerIdsRef.current.size > 1) {
      // 두 번째(이상) 손가락 — 그리기/드래그로 취급하지 않는다.
      cancelInteractionForMultiTouch();
      return;
    }

    pointerDownRef.current = { x: e.clientX, y: e.clientY, time: nowMs() };

    if (mode === "overview" && planeTool?.kind === "offset" && isNearOffsetArrow(e.clientX, e.clientY)) {
      arrowDragRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (mode === "sketch" && tool === "move") {
      const target = raycastToActivePlane(e.clientX, e.clientY);
      if (target) {
        // 화면에 보이는 꼭짓점만 잡는다. 자유곡선 내부 보간점을 잡으면
        // 곡선에서 뾰족하게 한 점만 튀어나오는 문제가 생긴다.
        const pointId = findNearbyActivePoint(target, NEARBY_POINT_THRESHOLD, true);
        if (pointId) {
          pushUndoSnapshot();
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
    // 굵은 선(Line2)은 기본 판정 폭이 선 두께(2.5px)뿐이라 손가락으로는
    // 거의 못 짚는다. 앞뒤로 넉넉히 여유를 준다(px).
    (raycaster.params as Record<string, unknown>).Line2 = { threshold: 18 };
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
    if (e.pointerType === "mouse" && e.button !== 0) return;
    activePointerIdsRef.current.delete(e.pointerId);
    pointerPositionsRef.current.delete(e.pointerId);
    if (activePointerIdsRef.current.size !== 3) panCentroidRef.current = null;
    if (activePointerIdsRef.current.size > 0) {
      // 아직 다른 손가락이 남아있다 (핀치/회전/이동 제스처 도중) — 그리기로 처리하지 않는다.
      pointerDownRef.current = null;
      return;
    }

    const down = pointerDownRef.current;
    pointerDownRef.current = null;

    if (arrowDragRef.current) {
      arrowDragRef.current = false;
      return;
    }

    if (draggingPointIdRef.current) {
      const draggedId = draggingPointIdRef.current;
      draggingPointIdRef.current = null;
      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) {
        undoStackRef.current.pop(); // 실제로 안 움직였으니 미리 찍어둔 스냅샷은 버린다
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
        // 이어그리기가 꺼져 있으면 탭 한 번으로는 아무것도 그리지 않는다
        // (선으로 이어지지도 않는 외톨이 점만 남는 걸 막기 위해).
      } else if (wasStraight) {
        // 직선 모드(체크박스 또는 1초 멈춤으로 전환) → 시작점~끝점 직선.
        // 드래그로 그은 선이라 점은 안 보여주고 치수만 보여준다.
        pushUndoSnapshot();
        commitDrawPointFromRaw(rawPoints[0], true, true, false);
        commitDrawPointFromRaw(rawPoints[rawPoints.length - 1], true, true, false);
      } else {
        // 자유곡선 그대로(삐뚤빼뚤 유지) → 궤적을 따라 여러 점으로 커밋
        pushUndoSnapshot();
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
    if (planeTool) {
      handlePlaneToolTap(e.clientX, e.clientY);
      return;
    }
    if (connectMode) {
      handleConnectTap(e.clientX, e.clientY);
      return;
    }
    handleOverviewClick(e.clientX, e.clientY);
  }

  function handleCanvasMove(e: React.PointerEvent) {
    if (pointerPositionsRef.current.has(e.pointerId)) {
      pointerPositionsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointerIdsRef.current.size === 3) {
      // 세 손가락 드래그 = 화면 이동. 오버뷰에서도 동작해야 하므로
      // 스케치 모드 제한보다 먼저 처리한다.
      const centroid = threeFingerPanCentroid();
      if (centroid) {
        if (panCentroidRef.current) {
          panCamera(
            centroid.x - panCentroidRef.current.x,
            centroid.y - panCentroidRef.current.y
          );
        }
        panCentroidRef.current = centroid;
      }
      return;
    }

    if (arrowDragRef.current && activePointerIdsRef.current.size <= 1) {
      dragOffsetArrow(e.clientX, e.clientY);
      return;
    }
    if (mode === "overview" && connectMode && connectFrom && activePointerIdsRef.current.size <= 1) {
      updateConnectPreview(e.clientX, e.clientY);
      return;
    }
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

      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      if (mode !== "sketch") {
        if (isUndo) {
          e.preventDefault();
          handleOverviewUndo();
        } else if (e.key === "Enter" && planeTool) {
          e.preventDefault();
          applyPlaneTool();
        } else if (e.key === "Escape") {
          if (planeTool) {
            cancelPlaneTool();
            return;
          }
          setConnectFrom(null);
          clearConnectPreview();
          setSelectedEdge(null);
        } else if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
          e.preventDefault();
          deleteStrokeInSketch(selectedEdge.sketchId, selectedEdge.edgeId);
        }
        return;
      }
      if (isUndo) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === "Escape") {
        handleNewStroke();
        selectActivePoint(null);
        return;
      }
      if (e.key === "Delete" || (e.key === "Backspace" && tool === "move")) {
        e.preventDefault();
        handleDeleteSelection();
        return;
      }
      handleDrawKeyDown(e);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tool, selectedPointId, selectedActiveEdgeId, selectedEdge, sketchOverrides, freeSketch, planeTool]);

  function handleClearAll() {
    if (!confirm("현재 스케치의 모든 점과 선을 지울까요? (실행 취소로 되돌릴 수 있습니다)")) return;
    pushUndoSnapshot();
    clearActiveGeometry();
    hideDrawPreview();
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    syncCounts();
    dirtyRef.current = true;
  }

  const selectedPlane = planes.find((p) => p.id === selectedPlaneId) ?? null;

  return (
    <div className="fixed inset-0 bg-[#faf6ee] overflow-hidden">
      {/* 좌측 트리 (캔버스 위에 떠 있는 패널, 레이아웃을 나누지 않음) — CATIA식 연결선 트리 */}
      <div className="absolute top-[4.75rem] left-3 z-10 w-64 max-h-[calc(100vh-5.5rem)] flex flex-col rounded-lg border border-black/10 bg-white/90 backdrop-blur-sm shadow-lg">
        <div className="flex-1 overflow-y-auto px-2 py-2 text-xs text-gray-700">
          <div className="flex items-center gap-1.5 h-6 px-1 font-bold text-gray-900">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 4h5l1.5 1.5H14v7.5H2z" />
            </svg>
            <span className="truncate">{projectName}</span>
          </div>
          {(() => {
            const rootChildCount = planes.length + (freeSketch ? 1 : 0);
            return (
              <>
                {planes.map((plane, pi) => {
                  const planeIsLast = pi === rootChildCount - 1;
                  const isCollapsed = collapsedPlaneIds.has(plane.id);
                  const isPlaneActive =
                    plane.id === (mode === "sketch" ? activePlaneId : selectedPlaneId);
                  const hasChildren = plane.sketches.length > 0;
                  return (
                    <div key={plane.id}>
                      <div className="flex items-stretch h-6">
                        <TreeGuides guides={[]} isLast={planeIsLast} />
                        <div
                          onClick={() => {
                            setSelectedPlaneId(plane.id);
                            setSelectedEdge(null);
                          }}
                          className={`group flex-1 min-w-0 flex items-center gap-1 pr-1 rounded cursor-pointer ${
                            isPlaneActive ? "bg-amber-100 text-gray-900" : "hover:bg-black/5"
                          }`}
                        >
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hasChildren) togglePlaneCollapsed(plane.id);
                            }}
                            className="w-3 shrink-0 text-center text-[9px] text-gray-400 select-none"
                          >
                            {hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
                          </span>
                          <svg
                            viewBox="0 0 16 16"
                            className="w-3.5 h-3.5 shrink-0 text-amber-600/80"
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
                            className="text-[11px] opacity-0 group-hover:opacity-70 hover:!opacity-100 px-1"
                            title="새 스케치 만들기"
                          >
                            +
                          </span>
                        </div>
                      </div>
                      {!isCollapsed &&
                        plane.sketches.map((sketch, si) => {
                          const isActiveSketch = sketch.id === activeSketchId;
                          return (
                            <div key={sketch.id} className="flex items-stretch h-6">
                              <TreeGuides
                                guides={[!planeIsLast]}
                                isLast={si === plane.sketches.length - 1}
                              />
                              <div
                                className={`group flex-1 min-w-0 flex items-center gap-1 pr-1 rounded ${
                                  isActiveSketch
                                    ? "bg-amber-200/70 text-gray-900 font-medium"
                                    : "text-gray-600 hover:bg-black/5"
                                }`}
                              >
                                <button
                                  onClick={() => enterSketch(plane, sketch)}
                                  className="flex-1 min-w-0 flex items-center gap-1 text-left truncate"
                                >
                                  <span className="text-gray-400">✎</span>
                                  <span className="truncate">{sketch.name}</span>
                                  <span className="opacity-50 shrink-0">
                                    (선 {countStrokes(sketch.edges)})
                                  </span>
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
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
                {freeSketch && (
                  <div className="flex items-stretch h-6">
                    <TreeGuides guides={[]} isLast />
                    <div className="flex-1 min-w-0 flex items-center gap-1 pl-4 pr-1 text-gray-600">
                      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0 text-amber-600/80" fill="none" stroke="currentColor" strokeWidth="1.3">
                        <path d="M3 13L8 3l5 10" />
                        <circle cx="3" cy="13" r="1.2" />
                        <circle cx="13" cy="13" r="1.2" />
                      </svg>
                      <span className="truncate">{freeSketch.name}</span>
                      <span className="opacity-50 shrink-0">(선 {countStrokes(freeSketch.edges)})</span>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* 캔버스 영역: 트리 패널 뒤까지 화면 전체를 채운다 */}
      <div className="absolute inset-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-black/10 bg-[#faf6ee]/90 backdrop-blur-sm">
          {mode === "overview" ? (
            <>
              <div className="flex items-center gap-1">
                <button
                  onClick={startPlaneTool}
                  disabled={busy || !!planeTool || (!selectedPlane && !selectedEdge)}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 disabled:opacity-40"
                  title="평면을 선택하면 오프셋/점 통과 평면, 선을 선택하면 선에 수직인 평면을 만듭니다"
                >
                  평면 추가
                </button>
                <button
                  onClick={() => {
                    if (connectMode) stopConnect();
                    else {
                      cancelPlaneTool();
                      setConnectMode(true);
                      setSelectedEdge(null);
                      setSelectedPlaneId(null);
                    }
                  }}
                  className={`ml-2 text-xs px-2.5 py-1.5 rounded-md border ${
                    connectMode
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-300"
                  }`}
                  title="서로 다른 스케치의 점(선 끝점 등)을 차례로 탭해서 3D 선으로 잇습니다"
                >
                  {connectMode ? "✎ 선 잇는 중 (끄기)" : "선 잇기"}
                </button>
                <button
                  onClick={handleOverviewUndo}
                  disabled={overviewUndoCount === 0}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 disabled:opacity-40"
                  title="오버뷰에서 한 선 잇기/지우기를 되돌립니다 (Ctrl+Z)"
                >
                  실행 취소
                </button>
              </div>

              {planeTool && (() => {
                const pv = planeToolPreview(planeTool);
                return (
                  <div className="flex flex-wrap items-center gap-2 text-xs bg-white border border-orange-300 rounded-md px-3 py-1.5">
                    {planeTool.kind === "offset" ? (
                      <>
                        <span className="text-gray-500">
                          기준 <b className="text-gray-800">{pv?.base?.label}</b> · 오프셋
                        </span>
                        <input
                          type="number"
                          step={10}
                          value={pv?.offsetMm ?? 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setPlaneTool({
                              ...planeTool,
                              offsetMm: Number.isNaN(v) ? 0 : Math.round(v),
                              throughPoint: null,
                            });
                          }}
                          className="w-20 border border-gray-300 rounded px-1.5 py-1"
                        />
                        <span className="text-gray-400">mm</span>
                        <button
                          onClick={() =>
                            setPlaneTool({
                              ...planeTool,
                              offsetMm: -(pv?.offsetMm ?? 0),
                              throughPoint: null,
                            })
                          }
                          className="px-2 py-1 rounded border border-gray-300 text-gray-600"
                        >
                          방향 반전
                        </button>
                        {planeTool.throughPoint && (
                          <span className="text-orange-700">
                            점 통과 ({planeTool.throughPoint.x}, {planeTool.throughPoint.y},{" "}
                            {planeTool.throughPoint.z})
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-500">
                        {planeTool.pick
                          ? `선 위 위치 (${planeTool.pick.point.x}, ${planeTool.pick.point.y}, ${planeTool.pick.point.z})mm`
                          : "선 위에서 평면을 세울 위치를 탭하세요"}
                      </span>
                    )}
                    <button
                      onClick={applyPlaneTool}
                      disabled={
                        busy ||
                        !pv ||
                        (planeTool.kind === "offset" && !planeTool.throughPoint && pv.offsetMm === 0)
                      }
                      className="px-2 py-1 rounded bg-gray-900 text-white disabled:opacity-40"
                    >
                      적용
                    </button>
                    <button onClick={cancelPlaneTool} className="px-2 py-1 rounded text-gray-400">
                      취소
                    </button>
                  </div>
                );
              })()}

              {selectedPlane && !planeTool && (
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

              {selectedEdge && !pendingPerpEdge && !planeTool && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">선 선택됨</span>
                  <button
                    onClick={() => deleteStrokeInSketch(selectedEdge.sketchId, selectedEdge.edgeId)}
                    className="px-2 py-1 rounded bg-red-500 text-white"
                  >
                    지우기
                  </button>
                  {selectedEdge.sketchId !== freeSketch?.id && (
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
                  )}
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

              {(selectedPointId || selectedActiveEdgeId) && !pendingPerpEdge && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">
                    {selectedPointId ? "점 선택됨" : "선 선택됨"}
                  </span>
                  <button
                    onClick={handleDeleteSelection}
                    className="px-2 py-1 rounded bg-red-500 text-white"
                  >
                    지우기
                  </button>
                  {selectedActiveEdgeId && (
                    <button
                      onClick={() => {
                        const e = activeEdgesRef.current.get(selectedActiveEdgeId);
                        const from = e && activePointsRef.current.get(e.fromId);
                        const to = e && activePointsRef.current.get(e.toId);
                        if (from && to) setPendingPerpEdge({ from, to });
                      }}
                      className="px-2 py-1 rounded border border-gray-300 text-gray-700"
                    >
                      이 선에 수직인 평면
                    </button>
                  )}
                  <button
                    onClick={() => selectActivePoint(null)}
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
                선 {strokeCount}개 · 점 {pointCount}개
              </span>
              {cursorMm && (
                <span>
                  커서: {cursorMm.x}, {cursorMm.y}, {cursorMm.z} mm
                </span>
              )}
              {tool === "move" && (
                <span>점을 끌어서 이동, 선을 탭하면 그 선(한 획) 전체가 선택됩니다. Delete 키로 지우기.</span>
              )}
              {tool === "pen" && typedLength && (
                <span className="text-gray-600">
                  숫자 입력 중: {typedLength}mm (Enter로 확정, Esc로 취소)
                </span>
              )}
            </>
          )}
          {mode === "overview" && (
            <span>
              {planeTool
                ? planeTool.kind === "offset"
                  ? "주황 화살표를 끌거나 치수를 눌러 입력하세요 · 점을 탭하면 그 점을 지나는 평행 평면 · Enter 적용"
                  : "선 위를 탭해 위치를 정한 뒤 적용하세요 · Esc 취소"
                : connectMode
                ? connectFrom
                  ? "이을 끝점을 탭하세요 (빈 곳 탭 또는 Esc로 취소)"
                  : "시작할 점(선 끝점 등)을 탭하세요 · 선을 탭하면 선택"
                : "평면을 탭하면 새 스케치, 선을 탭하면 선택됩니다."}
            </span>
          )}
          {pendingSaves > 0 && <span className="text-amber-700">저장 중…</span>}
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
