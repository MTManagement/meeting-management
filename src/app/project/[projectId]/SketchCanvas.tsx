"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { saveSketch } from "./actions";

type Axis = "XY" | "YZ" | "XZ";

type PlaneDef = { axis: Axis; offset: number };

type PointRec = { id: string; x: number; y: number; z: number };
type EdgeRec = { id: string; fromId: string; toId: string };

const PAPER_BG = 0xfaf6ee;
const PENCIL = 0x4b4b4b;
const PENCIL_LIGHT = 0x9a9284;

// 모든 좌표·오프셋 값의 단위는 mm. Three.js 씬 내부는 보기 좋은 스케일을 위해
// 1 scene 단위 = 1000mm(=1m)로 렌더링만 축소해서 그린다.
const MM_PER_SCENE_UNIT = 1000;
function mmToScene(mm: number) {
  return mm / MM_PER_SCENE_UNIT;
}
function sceneToMm(units: number) {
  return Math.round(units * MM_PER_SCENE_UNIT);
}

const BASE_PLANES: PlaneDef[] = [
  { axis: "XY", offset: 0 },
  { axis: "YZ", offset: 0 },
  { axis: "XZ", offset: 0 },
];

function planeKey(p: PlaneDef) {
  return `${p.axis}:${p.offset}`;
}

function toThreePlane(p: PlaneDef): THREE.Plane {
  const offset = mmToScene(p.offset);
  if (p.axis === "XY") return new THREE.Plane(new THREE.Vector3(0, 0, 1), -offset);
  if (p.axis === "YZ") return new THREE.Plane(new THREE.Vector3(1, 0, 0), -offset);
  return new THREE.Plane(new THREE.Vector3(0, 1, 0), -offset);
}

function planeMeshRotation(axis: Axis): [number, number, number] {
  if (axis === "XY") return [0, 0, 0];
  if (axis === "YZ") return [0, Math.PI / 2, 0];
  return [Math.PI / 2, 0, 0];
}

function planeMeshPosition(p: PlaneDef): [number, number, number] {
  const offset = mmToScene(p.offset);
  if (p.axis === "XY") return [0, 0, offset];
  if (p.axis === "YZ") return [offset, 0, 0];
  return [0, offset, 0];
}

export default function SketchCanvas({
  projectId,
  initialPoints,
  initialEdges,
  initialPlanes,
}: {
  projectId: string;
  initialPoints: PointRec[];
  initialEdges: EdgeRec[];
  initialPlanes: PlaneDef[];
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const planeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const pointMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const edgeLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const pointGroupRef = useRef<THREE.Group | null>(null);
  const edgeGroupRef = useRef<THREE.Group | null>(null);

  const pointsRef = useRef<Map<string, PointRec>>(new Map());
  const edgesRef = useRef<Map<string, EdgeRec>>(new Map());
  const lastPointIdRef = useRef<string | null>(null);

  const initialPlane =
    initialPlanes.find((p) => p.axis === "XY" && p.offset === 0) ?? BASE_PLANES[0];
  const activePlaneRef = useRef<PlaneDef>(initialPlane);

  const [planes, setPlanes] = useState<PlaneDef[]>(() => {
    const merged = [...BASE_PLANES];
    for (const p of initialPlanes) {
      if (!merged.some((m) => planeKey(m) === planeKey(p))) merged.push(p);
    }
    return merged;
  });
  const [activePlaneKey, setActivePlaneKey] = useState(planeKey(initialPlane));
  const [offsetInput, setOffsetInput] = useState("0");
  const [offsetAxis, setOffsetAxis] = useState<Axis>("XY");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pointCount, setPointCount] = useState(initialPoints.length);
  const [edgeCount, setEdgeCount] = useState(initialEdges.length);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    for (const p of initialPoints) pointsRef.current.set(p.id, p);
    for (const e of initialEdges) edgesRef.current.set(e.id, e);
  }, [initialPoints, initialEdges]);

  function addPointMesh(id: string, p: PointRec) {
    const geo = new THREE.SphereGeometry(0.06, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: PENCIL });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(mmToScene(p.x), mmToScene(p.y), mmToScene(p.z));
    pointGroupRef.current?.add(mesh);
    pointMeshesRef.current.set(id, mesh);
  }

  function removePointMesh(id: string) {
    const mesh = pointMeshesRef.current.get(id);
    if (!mesh) return;
    pointGroupRef.current?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    pointMeshesRef.current.delete(id);
  }

  function addEdgeLine(e: EdgeRec) {
    const from = pointsRef.current.get(e.fromId);
    const to = pointsRef.current.get(e.toId);
    if (!from || !to) return;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(mmToScene(from.x), mmToScene(from.y), mmToScene(from.z)),
      new THREE.Vector3(mmToScene(to.x), mmToScene(to.y), mmToScene(to.z)),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: PENCIL });
    const line = new THREE.Line(geo, mat);
    edgeGroupRef.current?.add(line);
    edgeLinesRef.current.set(e.id, line);
  }

  function removeEdgeLine(id: string) {
    const line = edgeLinesRef.current.get(id);
    if (!line) return;
    edgeGroupRef.current?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    edgeLinesRef.current.delete(id);
  }

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

    const pointGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    scene.add(pointGroup, edgeGroup);
    pointGroupRef.current = pointGroup;
    edgeGroupRef.current = edgeGroup;

    for (const [id, p] of pointsRef.current) addPointMesh(id, p);
    for (const [, e] of edgesRef.current) addEdgeLine(e);

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

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const [key, mesh] of planeMeshesRef.current) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      planeMeshesRef.current.delete(key);
    }
    for (const p of planes) {
      const key = planeKey(p);
      const isActive = key === activePlaneKey;
      const geo = new THREE.PlaneGeometry(10, 10, 10, 10);
      const mat = new THREE.MeshBasicMaterial({
        color: isActive ? PENCIL_LIGHT : 0xcfc7b8,
        wireframe: true,
        transparent: true,
        opacity: isActive ? 0.5 : 0.15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(...planeMeshRotation(p.axis));
      mesh.position.set(...planeMeshPosition(p));
      scene.add(mesh);
      planeMeshesRef.current.set(key, mesh);
    }
  }, [planes, activePlaneKey]);

  function findNearbyPoint(pos: THREE.Vector3): string | null {
    let best: string | null = null;
    let bestDist = 0.18; // scene 단위 (≈180mm) 이내면 기존 점에 스냅
    for (const [id, p] of pointsRef.current) {
      const d = pos.distanceTo(
        new THREE.Vector3(mmToScene(p.x), mmToScene(p.y), mmToScene(p.z))
      );
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  function raycastToActivePlane(clientX: number, clientY: number): THREE.Vector3 | null {
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

    const plane = toThreePlane(activePlaneRef.current);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    return hit ? target : null;
  }

  function handleCanvasMove(e: React.MouseEvent) {
    const target = raycastToActivePlane(e.clientX, e.clientY);
    if (!target) return;
    setCursorMm({ x: sceneToMm(target.x), y: sceneToMm(target.y), z: sceneToMm(target.z) });
  }

  function handleCanvasClick(e: React.MouseEvent) {
    const target = raycastToActivePlane(e.clientX, e.clientY);
    if (!target) return;

    let pointId = findNearbyPoint(target);
    if (!pointId) {
      pointId = `tmp_${crypto.randomUUID()}`;
      const rec: PointRec = {
        id: pointId,
        x: sceneToMm(target.x),
        y: sceneToMm(target.y),
        z: sceneToMm(target.z),
      };
      pointsRef.current.set(pointId, rec);
      addPointMesh(pointId, rec);
      setPointCount(pointsRef.current.size);
    }

    const last = lastPointIdRef.current;
    if (last && last !== pointId) {
      const edgeId = `tmp_${crypto.randomUUID()}`;
      const rec: EdgeRec = { id: edgeId, fromId: last, toId: pointId };
      edgesRef.current.set(edgeId, rec);
      addEdgeLine(rec);
      setEdgeCount(edgesRef.current.size);
    }
    lastPointIdRef.current = pointId;
  }

  function handleNewStroke() {
    lastPointIdRef.current = null;
  }

  function handleUndo() {
    const last = lastPointIdRef.current;
    if (!last) return;
    for (const [eid, e] of edgesRef.current) {
      if (e.toId === last || e.fromId === last) {
        removeEdgeLine(eid);
        edgesRef.current.delete(eid);
      }
    }
    if (pointsRef.current.get(last)?.id.startsWith("tmp_")) {
      removePointMesh(last);
      pointsRef.current.delete(last);
    }
    setPointCount(pointsRef.current.size);
    setEdgeCount(edgesRef.current.size);
    lastPointIdRef.current = null;
  }

  function handleClearAll() {
    if (!confirm("현재 스케치의 모든 점과 선을 지울까요? (저장 전까지는 되돌릴 수 있습니다)")) return;
    for (const id of [...pointMeshesRef.current.keys()]) removePointMesh(id);
    for (const id of [...edgeLinesRef.current.keys()]) removeEdgeLine(id);
    pointsRef.current.clear();
    edgesRef.current.clear();
    lastPointIdRef.current = null;
    setPointCount(0);
    setEdgeCount(0);
  }

  function handleAddOffsetPlane() {
    const offset = parseFloat(offsetInput);
    if (Number.isNaN(offset)) return;
    const p: PlaneDef = { axis: offsetAxis, offset };
    const key = planeKey(p);
    if (planes.some((x) => planeKey(x) === key)) {
      setActivePlaneKey(key);
      activePlaneRef.current = p;
      return;
    }
    setPlanes((prev) => [...prev, p]);
    setActivePlaneKey(key);
    activePlaneRef.current = p;
  }

  function selectPlane(p: PlaneDef) {
    activePlaneRef.current = p;
    setActivePlaneKey(planeKey(p));
    lastPointIdRef.current = null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const pointsArr = [...pointsRef.current.values()];
      const edgesArr = [...edgesRef.current.values()].map((e) => ({
        fromId: e.fromId,
        toId: e.toId,
      }));
      const planesArr = planes.map((p) => ({ axis: p.axis, offset: p.offset }));
      const result = await saveSketch(projectId, planesArr, pointsArr, edgesArr);

      for (const id of [...pointMeshesRef.current.keys()]) removePointMesh(id);
      for (const id of [...edgeLinesRef.current.keys()]) removeEdgeLine(id);
      pointsRef.current.clear();
      edgesRef.current.clear();

      for (const p of result.points) {
        pointsRef.current.set(p.id, p);
        addPointMesh(p.id, p);
      }
      for (const e of result.edges) {
        edgesRef.current.set(e.id, e);
        addEdgeLine(e);
      }
      lastPointIdRef.current = null;
      setPointCount(pointsRef.current.size);
      setEdgeCount(edgesRef.current.size);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#faf6ee]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-black/10 bg-[#faf6ee]">
        <div className="flex items-center gap-1 mr-2">
          {BASE_PLANES.map((p) => {
            const key = planeKey(p);
            return (
              <button
                key={key}
                onClick={() => selectPlane(p)}
                className={`text-xs px-2.5 py-1.5 rounded-md border ${
                  key === activePlaneKey
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-300"
                }`}
              >
                {p.axis}
              </button>
            );
          })}
        </div>

        {planes.filter((p) => p.offset !== 0).length > 0 && (
          <div className="flex items-center gap-1 mr-2">
            {planes
              .filter((p) => p.offset !== 0)
              .map((p) => {
                const key = planeKey(p);
                return (
                  <button
                    key={key}
                    onClick={() => selectPlane(p)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border ${
                      key === activePlaneKey
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-600 border-gray-300"
                    }`}
                  >
                    {p.axis}+{p.offset}mm
                  </button>
                );
              })}
          </div>
        )}

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
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
          >
            평면 추가
          </button>
        </div>

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
          className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      <div className="px-4 py-1 text-[11px] text-gray-400 flex gap-4">
        <span className="px-1.5 py-0.5 rounded bg-gray-900/5 text-gray-600 font-medium">
          단위: mm
        </span>
        <span>점 {pointCount}개 · 선 {edgeCount}개</span>
        <span>
          현재 평면: <b className="text-gray-600">{activePlaneKey}</b>
        </span>
        {cursorMm && (
          <span>
            커서: {cursorMm.x}, {cursorMm.y}, {cursorMm.z} mm
          </span>
        )}
        {savedAt && <span>마지막 저장: {savedAt.toLocaleTimeString("ko-KR")}</span>}
      </div>

      <div
        ref={mountRef}
        className="flex-1"
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMove}
      />
    </div>
  );
}
