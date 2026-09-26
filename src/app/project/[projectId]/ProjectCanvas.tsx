"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createOffsetPlane,
  createPerpendicularPlane,
  createSketch,
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
  const controlsRef = useRef<OrbitControls | null>(null);

  const planeCardGroupRef = useRef<THREE.Group | null>(null);
  const refGeometryGroupRef = useRef<THREE.Group | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const activePointGroupRef = useRef<THREE.Group | null>(null);
  const activeEdgeGroupRef = useRef<THREE.Group | null>(null);

  const activePointMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const activeEdgeLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const activePointsRef = useRef<Map<string, PointRec>>(new Map());
  const activeEdgesRef = useRef<Map<string, EdgeRec>>(new Map());
  const lastPointIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const [mode, setMode] = useState<"overview" | "sketch">("overview");
  const [activePlaneId, setActivePlaneId] = useState<string | null>(null);
  const [activeSketchId, setActiveSketchId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(true);

  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
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

  const activePlane = planes.find((p) => p.id === activePlaneId) ?? null;

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
    camera.position.set(6, 5, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1));

    const planeCardGroup = new THREE.Group();
    const refGeometryGroup = new THREE.Group();
    const gridGroup = new THREE.Group();
    const activePointGroup = new THREE.Group();
    const activeEdgeGroup = new THREE.Group();
    scene.add(planeCardGroup, refGeometryGroup, gridGroup, activePointGroup, activeEdgeGroup);
    planeCardGroupRef.current = planeCardGroup;
    refGeometryGroupRef.current = refGeometryGroup;
    gridGroupRef.current = gridGroup;
    activePointGroupRef.current = activePointGroup;
    activeEdgeGroupRef.current = activeEdgeGroup;

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
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
        for (const e of sketch.edges) {
          const from = pointById.get(e.fromId);
          const to = pointById.get(e.toId);
          if (!from || !to) continue;
          const geo = new THREE.BufferGeometry().setFromPoints([
            vecMm(from),
            vecMm(to),
          ]);
          const mat = new THREE.LineBasicMaterial({ color: PENCIL_DIM });
          const line = new THREE.Line(geo, mat);
          line.userData = {
            kind: "edge",
            sketchId: sketch.id,
            from,
            to,
          };
          refGroup.add(line);
        }
      }
    }
  }, [planes, activePlaneId, activeSketchId, mode, selectedPlaneId]);

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
  }
  function removeActiveEdgeLine(id: string) {
    const line = activeEdgeLinesRef.current.get(id);
    if (!line) return;
    activeEdgeGroupRef.current?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    activeEdgeLinesRef.current.delete(id);
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
  function enterSketch(plane: PlaneData, sketch: SketchData) {
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
    setDrawing(true);
    setSelectedPlaneId(null);
    setSelectedEdge(null);
    setPendingPerpEdge(null);
    snapCameraFlat(plane);
  }

  function exitSketch() {
    if (dirtyRef.current) {
      const ok = confirm("저장하지 않은 변경사항이 있습니다. 저장하지 않고 나가시겠습니까?");
      if (!ok) return;
    }
    clearActiveGeometry();
    setActivePlaneId(null);
    setActiveSketchId(null);
    setMode("overview");
    router.refresh();
  }

  async function handleCreateSketch(plane: PlaneData) {
    setBusy(true);
    try {
      const sketch = await createSketch(projectId, plane.id);
      enterSketch(plane, { id: sketch.id, name: sketch.name, points: [], edges: [] });
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

  function handleDrawClick(clientX: number, clientY: number) {
    const target = raycastToActivePlane(clientX, clientY);
    if (!target) return;

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
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (mode === "sketch") {
      if (drawing) handleDrawClick(e.clientX, e.clientY);
      return;
    }
    handleOverviewClick(e.clientX, e.clientY);
  }

  function handleCanvasMove(e: React.MouseEvent) {
    if (mode !== "sketch" || !drawing) return;
    const target = raycastToActivePlane(e.clientX, e.clientY);
    if (!target) return;
    setCursorMm({ x: sceneToMm(target.x), y: sceneToMm(target.y), z: sceneToMm(target.z) });
  }

  function handleTogglePen() {
    setDrawing((prev) => {
      const next = !prev;
      if (next && activePlane) snapCameraFlat(activePlane);
      return next;
    });
  }

  function handleNewStroke() {
    lastPointIdRef.current = null;
  }

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
    dirtyRef.current = true;
  }

  function handleClearAll() {
    if (!confirm("현재 스케치의 모든 점과 선을 지울까요? (저장 전까지는 되돌릴 수 있습니다)")) return;
    clearActiveGeometry();
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
    <div className="relative h-screen w-full bg-[#faf6ee] overflow-hidden">
      {/* 좌측 트리 (캔버스 위에 떠 있는 패널, 레이아웃을 나누지 않음) */}
      <div className="absolute top-[4.75rem] left-3 z-10 w-64 max-h-[calc(100vh-5.5rem)] flex flex-col rounded-lg border border-black/10 bg-white/90 backdrop-blur-sm shadow-lg">
        <div className="px-3 py-3 border-b border-black/10">
          <p className="text-sm font-bold text-gray-900 truncate">{projectName}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 text-xs">
          {planes.map((plane) => (
            <div key={plane.id} className="mb-1">
              <button
                onClick={() => {
                  setSelectedPlaneId(plane.id);
                  setSelectedEdge(null);
                }}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left ${
                  plane.id === (mode === "sketch" ? activePlaneId : selectedPlaneId)
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-black/5"
                }`}
              >
                <span>▢ {plane.label}</span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) handleCreateSketch(plane);
                  }}
                  className="text-[10px] opacity-70 hover:opacity-100 px-1"
                  title="새 스케치 만들기"
                >
                  +
                </span>
              </button>
              {plane.sketches.map((sketch) => (
                <button
                  key={sketch.id}
                  onClick={() => enterSketch(plane, sketch)}
                  className={`w-full text-left pl-6 pr-2 py-1 rounded-md ${
                    sketch.id === activeSketchId
                      ? "bg-gray-900/90 text-white"
                      : "text-gray-500 hover:bg-black/5"
                  }`}
                >
                  ✎ {sketch.name}{" "}
                  <span className="opacity-50">({sketch.points.length}점)</span>
                </button>
              ))}
            </div>
          ))}
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

              {pendingPerpEdge && (
                <div className="flex items-center gap-2 text-xs bg-white border border-gray-300 rounded-md px-3 py-1.5">
                  <span className="text-gray-500">끝점을 선택하세요</span>
                  <button
                    onClick={() => !busy && handleCreatePerpPlane(pendingPerpEdge.from)}
                    disabled={busy}
                    className="px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
                  >
                    시작점 ({pendingPerpEdge.from.x}, {pendingPerpEdge.from.y},{" "}
                    {pendingPerpEdge.from.z})mm
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
                onClick={handleTogglePen}
                className={`text-xs px-2.5 py-1.5 rounded-md border ${
                  drawing
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-300"
                }`}
              >
                ✎ 그리기
              </button>
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
                onClick={handleSave}
                disabled={saving}
                className="ml-auto text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </>
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
              {savedAt && <span>마지막 저장: {savedAt.toLocaleTimeString("ko-KR")}</span>}
            </>
          )}
          {mode === "overview" && <span>평면이나 선을 클릭해서 선택하세요.</span>}
        </div>

        <div
          ref={mountRef}
          className="flex-1"
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
        />
      </div>
    </div>
  );
}
