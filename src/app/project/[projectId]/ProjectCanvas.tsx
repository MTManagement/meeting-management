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
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
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
const ERASE_COLOR = 0xdc2626; // 지우개가 지울 선 미리보기 (빨강)
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
    input.value = div.textContent?.replace(/[^0-9.-]/g, "") ?? "";
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
function groupByStroke(edges: Iterable<EdgeRec>) {
  const groups = new Map<string, EdgeRec[]>();
  for (const e of edges) {
    const k = strokeKeyOf(e);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  return groups;
}

// ── 스케치 도구 ────────────────────────────────────────────────────
// select: 선택·수정(기본) / free: 자유 그리기 / line: 직선 / rect: 사각형 / circle: 원
type Tool = "select" | "free" | "line" | "rect" | "circle" | "eraseObj" | "eraseSeg";
const TOOL_DEFS: { id: Tool; key: string; title: string }[] = [
  { id: "select", key: "v", title: "선택·수정 (V) — 점을 끌어 이동, 선을 탭해 선택" },
  { id: "free", key: "p", title: "자유 그리기 (P) — 그은 궤적 그대로, 1초 멈추면 직선" },
  { id: "line", key: "l", title: "직선 (L) — 누른 채 끌어서 직선, 이어그리기 가능" },
  { id: "rect", key: "r", title: "사각형 (R) — 한 꼭짓점과 대각선 꼭짓점을 찍어서" },
  { id: "circle", key: "c", title: "원 (C) — 중심을 찍고 크기를 정해서" },
  { id: "eraseObj", key: "e", title: "개체 지우개 (E) — 선을 탭하거나 문지르면 그 개체(한 획) 전체를 지웁니다" },
  { id: "eraseSeg", key: "t", title: "조각 지우개 (T) — 다른 선과 만나는 교차점 사이 조각만 지웁니다" },
];
const isDrawTool = (t: Tool) => t === "free" || t === "line" || t === "rect" || t === "circle";
const isEraseTool = (t: Tool) => t === "eraseObj" || t === "eraseSeg";

// 사각형·원은 DB 구조를 바꾸지 않고 획 id(strokeId) 앞에 도형 종류를
// 붙여 저장한다. 나중에 진짜 원/사각형 타입으로 옮길 때 이 표시로 변환한다.
const RECT_PREFIX = "rect:";
const CIRCLE_PREFIX = "circle:";
const CIRCLE_SEGMENTS = 72;
const RECT_TOL = 0.002; // scene 단위 ≈ 2mm, 좌표가 mm로 반올림돼 저장되므로 여유를 둔다

// ── 자석(오브젝트) 스냅 ─────────────────────────────────────────────
// 붙는 거리는 mm가 아니라 화면 픽셀 기준 — 확대/축소와 무관하게 손맛이 같다.
const SNAP_PX_MOUSE = 14;
const SNAP_PX_TOUCH = 28;
// 선을 탭/클릭해서 고를 때 허용 거리(화면 픽셀)
const PICK_PX_MOUSE = 10;
const PICK_PX_TOUCH = 22;
const ON_PLANE_TOL = 0.001; // scene 단위 ≈ 1mm, 다른 스케치가 이 평면 위에 있는지 판정

type SnapKind = "origin" | "end" | "mid" | "center" | "cross" | "on";
const SNAP_LABEL: Record<SnapKind, string> = {
  origin: "원점",
  end: "끝점",
  mid: "중점",
  center: "중심",
  cross: "교차점",
  on: "선 위",
};
type SnapHit = { pos: THREE.Vector3; kind: SnapKind; pointId?: string };
type SnapRefs = {
  points: { pos: THREE.Vector3; kind: SnapKind }[];
  segs: [THREE.Vector3, THREE.Vector3][];
};

// 스케치의 (0,0) = 월드 원점(0,0,0)을 스케치 평면에 수직으로 내린 점(mm).
// XY·YZ·XZ 기본 평면은 원점을 지나므로 (0,0,0) 그대로다.
function sketchOriginMm(plane: PlaneData): Vec3 {
  const n = vecUnit(plane.normal);
  const d = n.x * plane.origin.x + n.y * plane.origin.y + n.z * plane.origin.z;
  return { x: n.x * d, y: n.y * d, z: n.z * d };
}

function closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-12) return a.clone();
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / len2));
  return a.clone().add(ab.multiplyScalar(t));
}

// "곧은 선"(치수가 붙는 선)인지: 선분 하나짜리 획이거나 양끝이 보이는 꼭짓점.
// 자유곡선의 잘게 쪼갠 조각은 아니다 — 중점 스냅은 곧은 선에만 준다.
function isStraightEdge(
  e: EdgeRec,
  pointById: Map<string, PointRec>,
  strokeSizes: Map<string, number>
) {
  if ((strokeSizes.get(strokeKeyOf(e)) ?? 1) === 1) return true;
  const a = pointById.get(e.fromId);
  const b = pointById.get(e.toId);
  return a?.isVertex !== false && b?.isVertex !== false;
}

function circleInfo(edges: EdgeRec[], pointById: Map<string, PointRec>) {
  if (edges.length < 8 || !edges[0].strokeId?.startsWith(CIRCLE_PREFIX)) return null;
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.fromId);
    ids.add(e.toId);
  }
  const pts = [...ids].map((id) => pointById.get(id)).filter((p): p is PointRec => !!p);
  if (pts.length < 8) return null;
  const center = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  };
  const radiusMm =
    pts.reduce((s, p) => s + Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z), 0) /
    pts.length;
  return { center, radiusMm, pointIds: [...ids] };
}

// 사각형 획(rect:)이 여전히 온전한 직사각형이면 네 꼭짓점의 평면 기준 좌표를
// 돌려준다. 점을 지우는 등으로 모양이 깨졌으면 null(보통 선처럼 취급).
type RectInfo = {
  corners: { id: string; u: number; v: number }[];
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
};
function rectInfo(
  plane: PlaneData,
  edges: EdgeRec[],
  pointById: Map<string, PointRec>
): RectInfo | null {
  if (edges.length !== 4 || !edges[0].strokeId?.startsWith(RECT_PREFIX)) return null;
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.fromId);
    ids.add(e.toId);
  }
  if (ids.size !== 4) return null;
  const corners: RectInfo["corners"] = [];
  for (const id of ids) {
    const p = pointById.get(id);
    if (!p) return null;
    const { u, v } = toLocalUV(plane, vecMm(p));
    corners.push({ id, u, v });
  }
  const us = corners.map((c) => c.u);
  const vs = corners.map((c) => c.v);
  const info = {
    corners,
    uMin: Math.min(...us),
    uMax: Math.max(...us),
    vMin: Math.min(...vs),
    vMax: Math.max(...vs),
  };
  const tol = RECT_TOL;
  if (info.uMax - info.uMin < tol || info.vMax - info.vMin < tol) return null;
  const onCorner = corners.every(
    (c) =>
      (Math.abs(c.u - info.uMin) < tol || Math.abs(c.u - info.uMax) < tol) &&
      (Math.abs(c.v - info.vMin) < tol || Math.abs(c.v - info.vMax) < tol)
  );
  return onCorner ? info : null;
}
// 사각형에서 치수를 보여줄 두 변: 아래 가로변과 오른쪽 세로변.
function rectLabelEdgeIds(plane: PlaneData, edges: EdgeRec[], pointById: Map<string, PointRec>) {
  const info = rectInfo(plane, edges, pointById);
  if (!info) return null;
  const uv = new Map(info.corners.map((c) => [c.id, c]));
  const tol = RECT_TOL;
  const result = new Set<string>();
  for (const e of edges) {
    const a = uv.get(e.fromId)!;
    const b = uv.get(e.toId)!;
    const horizontal = Math.abs(a.v - b.v) < tol;
    if (horizontal && Math.abs(a.v - info.vMin) < tol) result.add(e.id);
    if (!horizontal && Math.abs(a.u - info.uMax) < tol) result.add(e.id);
  }
  return result;
}

// 다른 스케치들 중에서 지금 스케치 평면에 붙을 수 있는 점·선을 모은다.
// - 이 평면 위에 놓인 점(끝점)·선(선 위, 중점)
// - 이 평면을 뚫고 지나가는 선의 교차점 (CATIA에서 다른 요소를 참조하는 느낌)
function buildOtherSnapRefs(plane: PlaneData, sketches: SketchData[]): SnapRefs {
  const tp = toThreePlane(plane);
  const refs: SnapRefs = { points: [], segs: [] };
  for (const sk of sketches) {
    const pointById = new Map(sk.points.map((p) => [p.id, p]));
    const degree = new Map<string, number>();
    const strokeSizes = new Map<string, number>();
    for (const e of sk.edges) {
      degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1);
      degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1);
      const k = strokeKeyOf(e);
      strokeSizes.set(k, (strokeSizes.get(k) ?? 0) + 1);
    }
    for (const p of sk.points) {
      if (p.isVertex === false && degree.get(p.id) !== 1) continue;
      const pos = vecMm(p);
      if (Math.abs(tp.distanceToPoint(pos)) < ON_PLANE_TOL) refs.points.push({ pos, kind: "end" });
    }
    for (const [, group] of groupByStroke(sk.edges)) {
      const ci = circleInfo(group, pointById);
      if (!ci) continue;
      const c = vecMm(ci.center);
      if (Math.abs(tp.distanceToPoint(c)) < ON_PLANE_TOL) refs.points.push({ pos: c, kind: "center" });
    }
    for (const e of sk.edges) {
      const a = pointById.get(e.fromId);
      const b = pointById.get(e.toId);
      if (!a || !b) continue;
      const av = vecMm(a);
      const bv = vecMm(b);
      const da = tp.distanceToPoint(av);
      const db = tp.distanceToPoint(bv);
      if (Math.abs(da) < ON_PLANE_TOL && Math.abs(db) < ON_PLANE_TOL) {
        refs.segs.push([av, bv]);
        if (isStraightEdge(e, pointById, strokeSizes)) {
          refs.points.push({ pos: av.clone().add(bv).multiplyScalar(0.5), kind: "mid" });
        }
      } else if (da * db < 0) {
        refs.points.push({ pos: av.clone().lerp(bv, da / (da - db)), kind: "cross" });
      }
    }
  }
  return refs;
}

// ── 조각 지우개(CAD의 트림): 누른 자리에서 획을 따라 양쪽으로 가다가 처음
// 만나는 교차점(다른 선·자기 자신과 엇갈리는 곳·다른 선 끝이 닿은 곳)까지를 지울 조각으로 본다.
// 결과는 선분마다 지울 구간 [t0, t1] (선분 from→to 기준 0~1).
type UV = { u: number; v: number };
const TRIM_TOL = 0.0015; // scene 단위 ≈ 1.5mm — mm 반올림으로 살짝 떨어진 T자 접점도 교차로 본다
const T_EPS = 1e-6;

function segCrossT(p0: UV, p1: UV, q0: UV, q1: UV, tol: number): number | null {
  const rx = p1.u - p0.u;
  const ry = p1.v - p0.v;
  const sx = q1.u - q0.u;
  const sy = q1.v - q0.v;
  const pLen = Math.hypot(rx, ry);
  const qLen = Math.hypot(sx, sy);
  if (pLen < 1e-9 || qLen < 1e-9) return null;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9 * pLen * qLen) return null; // 평행(겹침은 교차로 보지 않음)
  const qpx = q0.u - p0.u;
  const qpy = q0.v - p0.v;
  const t = (qpx * sy - qpy * sx) / den;
  const s = (qpx * ry - qpy * rx) / den;
  const tTol = tol / pLen;
  const sTol = tol / qLen;
  if (t < -tTol || t > 1 + tTol || s < -sTol || s > 1 + sTol) return null;
  return Math.min(1, Math.max(0, t));
}

function computeTrimPiece(
  plane: PlaneData,
  points: Map<string, PointRec>,
  edges: Map<string, EdgeRec>,
  extraCutters: [THREE.Vector3, THREE.Vector3][],
  edgeId: string,
  at: THREE.Vector3
): Map<string, [number, number][]> | null {
  const e0 = edges.get(edgeId);
  if (!e0) return null;
  const key = strokeKeyOf(e0);
  const uvCache = new Map<string, UV>();
  const uvOf = (id: string) => {
    let uv = uvCache.get(id);
    if (!uv) {
      const p = points.get(id);
      uv = p ? toLocalUV(plane, vecMm(p)) : { u: 0, v: 0 };
      uvCache.set(id, uv);
    }
    return uv;
  };

  type Cutter = { a: UV; b: UV; minU: number; maxU: number; minV: number; maxV: number; same?: EdgeRec };
  const cutters: Cutter[] = [];
  const addCutter = (a: UV, b: UV, same?: EdgeRec) =>
    cutters.push({
      a,
      b,
      minU: Math.min(a.u, b.u) - TRIM_TOL,
      maxU: Math.max(a.u, b.u) + TRIM_TOL,
      minV: Math.min(a.v, b.v) - TRIM_TOL,
      maxV: Math.max(a.v, b.v) + TRIM_TOL,
      same,
    });
  const adj = new Map<string, EdgeRec[]>();
  for (const e of edges.values()) {
    if (!points.has(e.fromId) || !points.has(e.toId)) continue;
    const inStroke = strokeKeyOf(e) === key;
    addCutter(uvOf(e.fromId), uvOf(e.toId), inStroke ? e : undefined);
    if (!inStroke) continue;
    for (const id of [e.fromId, e.toId]) {
      const list = adj.get(id);
      if (list) list.push(e);
      else adj.set(id, [e]);
    }
  }
  for (const [a, b] of extraCutters) addCutter(toLocalUV(plane, a), toLocalUV(plane, b));

  const cutCache = new Map<string, number[]>();
  const cutsOf = (e: EdgeRec) => {
    const cached = cutCache.get(e.id);
    if (cached) return cached;
    const a = uvOf(e.fromId);
    const b = uvOf(e.toId);
    const minU = Math.min(a.u, b.u);
    const maxU = Math.max(a.u, b.u);
    const minV = Math.min(a.v, b.v);
    const maxV = Math.max(a.v, b.v);
    const ts: number[] = [];
    for (const c of cutters) {
      if (c.maxU < minU || c.minU > maxU || c.maxV < minV || c.minV > maxV) continue;
      let tol = TRIM_TOL;
      if (c.same) {
        // 같은 획: 이웃 선분(점을 공유)은 건너뛰고, 진짜로 엇갈릴 때만 교차로 본다.
        if (c.same.id === e.id) continue;
        const s = c.same;
        if (s.fromId === e.fromId || s.fromId === e.toId || s.toId === e.fromId || s.toId === e.toId) continue;
        tol = 0;
      }
      const t = segCrossT(a, b, c.a, c.b, tol);
      if (t !== null) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    cutCache.set(e.id, ts);
    return ts;
  };

  const removed = new Map<string, [number, number][]>();
  const addIv = (id: string, t0: number, t1: number) => {
    const list = removed.get(id);
    if (list) list.push([t0, t1]);
    else removed.set(id, [[t0, t1]]);
  };

  const a0 = vecMm(points.get(e0.fromId)!);
  const b0 = vecMm(points.get(e0.toId)!);
  const ab = b0.clone().sub(a0);
  const tAt = ab.lengthSq() > 1e-12 ? Math.min(1, Math.max(0, at.clone().sub(a0).dot(ab) / ab.lengthSq())) : 0.5;

  const walk = (forward: boolean) => {
    let e = e0;
    let t = tAt;
    let fwd = forward;
    const visited = new Set<string>();
    for (;;) {
      const cuts = cutsOf(e);
      let cut: number | null = null;
      if (fwd) {
        for (const c of cuts) if (c > t + T_EPS) { cut = c; break; }
      } else {
        for (let i = cuts.length - 1; i >= 0; i--) if (cuts[i] < t - T_EPS) { cut = cuts[i]; break; }
      }
      if (cut !== null) {
        addIv(e.id, fwd ? t : cut, fwd ? cut : t);
        return;
      }
      addIv(e.id, fwd ? t : 0, fwd ? 1 : t);
      visited.add(e.id);
      const node = fwd ? e.toId : e.fromId;
      const nexts = (adj.get(node) ?? []).filter((x) => x.id !== e.id);
      if (nexts.length !== 1) return; // 획 끝 또는 갈림길
      const n = nexts[0];
      if (n.id === e0.id || visited.has(n.id)) return; // 닫힌 도형을 한 바퀴 돎
      fwd = n.fromId === node;
      t = fwd ? 0 : 1;
      // 들어가는 자리(node)에 바로 교차점이 있으면 거기서 멈춘다
      const nc = cutsOf(n);
      if (fwd ? nc.some((c) => c <= T_EPS) : nc.some((c) => c >= 1 - T_EPS)) return;
      e = n;
    }
  };
  walk(true);
  walk(false);
  return removed;
}

// 지울 구간들을 합쳐서 남길 구간(0~1 중 나머지)을 돌려준다.
function keptIntervals(removed: [number, number][], minLen: number): [number, number][] {
  const sorted = [...removed].sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + T_EPS) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const kept: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of merged) {
    if (a - cur > minLen) kept.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (1 - cur > minLen) kept.push([cur, 1]);
  return kept;
}

function ToolIcon({ kind }: { kind: Tool }) {
  const common = {
    viewBox: "0 0 20 20",
    className: "w-5 h-5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "select":
      return (
        <svg {...common}>
          <path d="M5 3 L5 15.5 L8.3 12.4 L10.6 17.2 L12.7 16.2 L10.4 11.5 L15 11.2 Z" />
        </svg>
      );
    case "free":
      // 45°로 기울어진 연필
      return (
        <svg {...common}>
          <path d="M3.5 16.5 L4.3 13.2 L13.2 4.3 a1.6 1.6 0 0 1 2.3 0 l0.2 0.2 a1.6 1.6 0 0 1 0 2.3 L6.8 15.7 Z" />
          <path d="M11.8 5.7 L14.3 8.2" />
          <path d="M4.3 13.2 L6.8 15.7" />
        </svg>
      );
    case "line":
      return (
        <svg {...common}>
          <path d="M5 15 L15 5" />
          <circle cx="5" cy="15" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="13" height="10" rx="0.5" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6.5" />
          <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "eraseObj":
      // 큰 지우개 + 바닥선: 개체 통째로
      return (
        <svg {...common}>
          <path d="M8 16.5 L3.5 12 L11 4.5 L15.5 9 Z" />
          <path d="M3.5 12 L6.5 9 L11 13.5 L8 16.5 Z" fill="currentColor" fillOpacity="0.35" />
          <path d="M8 16.5 H17" />
        </svg>
      );
    case "eraseSeg":
      // 작은 지우개 + 교차점(눈금) 사이만 점선: 조각만
      return (
        <svg {...common}>
          <path d="M9.5 13.5 L6 10 L11.5 4.5 L15 8 Z" strokeWidth={1.3} />
          <path d="M6 10 L8.2 7.8 L11.7 11.3 L9.5 13.5 Z" fill="currentColor" fillOpacity="0.35" strokeWidth={1.3} />
          <path d="M2 17 H6 M14 17 H18" />
          <path d="M6 17 H14" strokeDasharray="1.2 1.6" />
          <path d="M6 15 V19 M14 15 V19" strokeWidth={1.2} />
        </svg>
      );
  }
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12 a8 8 0 1 0 2.35 -5.65 L4 8.7" />
      <path d="M4 4.5 V8.7 H8.2" />
    </svg>
  );
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
const DOT_PX = 7;
const DOT_SELECTED_PX = 10;
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
  // 지우개: 누른 채 문지르는 동안의 상태(손가락은 움직이기 전까지 지우지 않는다 —
  // 두 손가락 확대를 하려다 첫 손가락 자리의 선이 지워지는 걸 막기 위해).
  const eraseGestureRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    rubbing: boolean;
    snapshotPushed: boolean;
  } | null>(null);
  const erasePreviewRef = useRef<LineSegments2 | null>(null);
  // 마지막으로 계산한 "지울 대상" — 같은 조각 위에서 마우스가 움직일 땐 다시 계산하지 않는다.
  const erasePreviewCacheRef = useRef<Map<string, [number, number][]> | null>(null);
  const draggingPointIdRef = useRef<string | null>(null);
  // 선택 도구에서 선을 잡고 끌면 그 획(사각형·원·직선·펜선) 전체를 옮긴다.
  const strokeDragRef = useRef<{
    key: string;
    edgeId: string;
    grab: THREE.Vector3;
    orig: Map<string, THREE.Vector3>;
    labelOrig: THREE.Vector3 | null;
  } | null>(null);
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
  const [tool, setTool] = useState<Tool>("select");

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

  // 직선 도구에서 "이어그리기"를 켜면 탭으로 점을 찍어서 잇는다(오토캐드식).
  // 끄면 누른 채 끌어서 시작~끝 직선을 하나씩 긋는다.
  const [chainMode, setChainMode] = useState(false);

  // 사각형·원 도구: 첫 점(꼭짓점/중심)을 찍은 뒤 두 번째 점을 기다리는 상태.
  // 탭-탭(첫 점 탭, 대각선 점 탭)과 누른 채 끌기 둘 다 된다.
  const shapeStartRef = useRef<THREE.Vector3 | null>(null);
  const shapeStartedThisDownRef = useRef(false);
  const lastShapeEndRef = useRef<THREE.Vector3 | null>(null);
  const [shapePending, setShapePending] = useState(false);
  // 치수 직접 입력: 사각형은 a=가로, b=세로 / 원은 a=지름. field는 키보드 입력이 들어갈 칸.
  const shapeDimsRef = useRef<{ a: string; b: string; field: 0 | 1 }>({ a: "", b: "", field: 0 });
  const [shapeDims, setShapeDimsState] = useState<{ a: string; b: string; field: 0 | 1 }>({
    a: "",
    b: "",
    field: 0,
  });
  const shapePreviewRef = useRef<THREE.LineLoop | null>(null);
  const shapePreviewLabelsRef = useRef<CSS2DObject[]>([]);
  const activeShapeLabelsRef = useRef<Map<string, CSS2DObject>>(new Map()); // 원 지름 라벨
  const snapMarkerRef = useRef<THREE.Points | null>(null);
  const snapLabelRef = useRef<CSS2DObject | null>(null);
  const lastPointerTypeRef = useRef<string>("mouse");

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

  // 스케치 안에서 자석처럼 붙을 다른 스케치들의 점·선 (이 평면 기준)
  const otherSnapRefs = useMemo<SnapRefs | null>(() => {
    if (mode !== "sketch" || !activePlane) return null;
    const others = [...planes.flatMap((p) => p.sketches), ...(freeSketch ? [freeSketch] : [])].filter(
      (s) => s.id !== activeSketchId
    );
    return buildOtherSnapRefs(activePlane, others);
  }, [mode, activePlane, planes, freeSketch, activeSketchId]);

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
      if (!mount || mount.clientWidth === 0 || mount.clientHeight === 0) return;
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
    // 창 크기뿐 아니라 도구 막대가 두 줄로 늘어나 캔버스 높이가 바뀔 때도 맞춘다
    // (안 맞추면 화면이 늘어져 보이고 탭 위치와 선택 위치가 어긋난다).
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
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
    pushUndoSnapshot();
    // 사각형의 변이면 사각형 모양을 유지한 채 가로/세로만 바꾼다.
    const rect = rectOfStroke(strokeKeyOf(e));
    if (rect) {
      applyRectSize(rect, e, newLenMm);
      dirtyRef.current = true;
      return;
    }
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
  function refreshEdgesForPoint(pointIds: string | Set<string>) {
    const ids = typeof pointIds === "string" ? new Set([pointIds]) : pointIds;
    for (const [edgeId, e] of activeEdgesRef.current) {
      if (!ids.has(e.fromId) && !ids.has(e.toId)) continue;
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
    clearShapeLabels();
    activePointsRef.current.clear();
    activeEdgesRef.current.clear();
    lastPointIdRef.current = null;
  }

  // 점 위치를 그대로(스냅 없이) 옮기고 연결된 선·라벨을 갱신한다.
  function setPointPos(pointId: string, pos: THREE.Vector3) {
    const rec = activePointsRef.current.get(pointId);
    if (!rec) return;
    rec.x = sceneToMm(pos.x);
    rec.y = sceneToMm(pos.y);
    rec.z = sceneToMm(pos.z);
    activePointMeshesRef.current.get(pointId)?.position.copy(vecMm(rec));
    refreshEdgesForPoint(pointId);
  }

  // ── 사각형·원: 모양을 유지한 편집 ───────────────────────────────
  function rectOfStroke(key: string, plane: PlaneData | null = activePlane) {
    if (!plane || !key.startsWith(RECT_PREFIX)) return null;
    const edges = [...activeEdgesRef.current.values()].filter((e) => strokeKeyOf(e) === key);
    return rectInfo(plane, edges, activePointsRef.current);
  }
  function rectOfPoint(pointId: string) {
    for (const e of activeEdgesRef.current.values()) {
      if (e.fromId !== pointId && e.toId !== pointId) continue;
      const rect = rectOfStroke(strokeKeyOf(e));
      if (rect) return rect;
    }
    return null;
  }
  function setRectCorners(rect: RectInfo, uFor: (u: number) => number, vFor: (v: number) => number) {
    if (!activePlane) return;
    for (const c of rect.corners) setPointPos(c.id, fromLocalUV(activePlane, uFor(c.u), vFor(c.v)));
  }
  // 꼭짓점 하나를 끌면 대각선 반대 꼭짓점은 고정, 직사각형을 유지한다.
  function moveRectCorner(rect: RectInfo, pointId: string, target: THREE.Vector3) {
    if (!activePlane) return;
    const c = rect.corners.find((k) => k.id === pointId);
    if (!c) return;
    const opp = {
      u: Math.abs(c.u - rect.uMin) < RECT_TOL ? rect.uMax : rect.uMin,
      v: Math.abs(c.v - rect.vMin) < RECT_TOL ? rect.vMax : rect.vMin,
    };
    const t = toLocalUV(activePlane, target);
    setRectCorners(
      rect,
      (u) => (Math.abs(u - c.u) < RECT_TOL ? t.u : opp.u),
      (v) => (Math.abs(v - c.v) < RECT_TOL ? t.v : opp.v)
    );
  }
  // 치수 라벨 입력: 가로변이면 왼쪽을 고정하고 가로를, 세로변이면 아래를 고정하고 세로를 바꾼다.
  function applyRectSize(rect: RectInfo, edge: EdgeRec, newLenMm: number) {
    const a = rect.corners.find((k) => k.id === edge.fromId);
    const b = rect.corners.find((k) => k.id === edge.toId);
    if (!a || !b) return;
    const len = mmToScene(newLenMm);
    if (Math.abs(a.v - b.v) < RECT_TOL) {
      setRectCorners(rect, (u) => (Math.abs(u - rect.uMax) < RECT_TOL ? rect.uMin + len : u), (v) => v);
    } else {
      setRectCorners(rect, (u) => u, (v) => (Math.abs(v - rect.vMax) < RECT_TOL ? rect.vMin + len : v));
    }
  }
  // 원 지름 라벨 입력: 중심은 고정하고 크기만 바꾼다.
  function applyCircleDiameter(key: string, diameterMm: number) {
    const edges = [...activeEdgesRef.current.values()].filter((e) => strokeKeyOf(e) === key);
    const info = circleInfo(edges, activePointsRef.current);
    if (!info || info.radiusMm <= 0) return;
    pushUndoSnapshot();
    const scale = diameterMm / 2 / info.radiusMm;
    const c = info.center;
    for (const id of info.pointIds) {
      const p = activePointsRef.current.get(id);
      if (!p) continue;
      setPointPos(
        id,
        vecMm({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale, z: c.z + (p.z - c.z) * scale })
      );
    }
    rebuildShapeLabels();
    dirtyRef.current = true;
  }
  function clearShapeLabels() {
    for (const l of activeShapeLabelsRef.current.values()) activeLabelGroupRef.current?.remove(l);
    activeShapeLabelsRef.current.clear();
  }
  // 원마다 지름 라벨(Ø)을 하나씩 붙인다. 원을 이루는 72개 조각에는 치수를 안 붙인다.
  function rebuildShapeLabels(plane: PlaneData | null = activePlane) {
    clearShapeLabels();
    if (!plane) return;
    const { uAxis } = planeBasis(plane);
    for (const [key, edges] of groupByStroke(activeEdgesRef.current.values())) {
      if (!key.startsWith(CIRCLE_PREFIX)) continue;
      const info = circleInfo(edges, activePointsRef.current);
      if (!info) continue;
      const div = createEditableLabelDiv(`Ø${Math.round(info.radiusMm * 2)}mm`, (mm) =>
        applyCircleDiameter(key, mm)
      );
      const label = new CSS2DObject(div);
      label.position.copy(vecMm(info.center).add(uAxis.clone().multiplyScalar(mmToScene(info.radiusMm))));
      activeLabelGroupRef.current?.add(label);
      activeShapeLabelsRef.current.set(key, label);
    }
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
    erasePreviewCacheRef.current = null; // 모양이 바뀌기 직전 — 지우개 대상 계산도 다시 해야 한다
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
    rebuildShapeLabels();
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
    const { origin, uAxis, vAxis } = planeBasis(activePlane);
    points.position.copy(origin);
    points.quaternion.copy(planeQuaternion(activePlane));
    gridGroup.add(points);

    // 스케치 원점 (0,0): 월드 원점을 이 평면에 내린 점. 가로·세로 기준선을 옅게 표시.
    const o = vecMm(sketchOriginMm(activePlane));
    const half = mmToScene(400);
    for (const axis of [uAxis, vAxis]) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        o.clone().add(axis.clone().multiplyScalar(-half)),
        o.clone().add(axis.clone().multiplyScalar(half)),
      ]);
      const lineMat = new THREE.LineDashedMaterial({ color: REF_EDGE, dashSize: 0.02, gapSize: 0.015 });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      gridGroup.add(line);
    }
    gridGroup.add(makeDot(o, REF_EDGE, 8));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activePlaneId]);

  // OrbitControls는 생성될 때의 camera.up(월드 Z축)을 기준으로 회전축을
  // 한 번만 계산해두고 그 뒤로 다시 읽지 않는다(three.js 소스 확인).
  // 그래서 여기서 camera.up을 평면마다 바꿔버리면 화면에 보이는 방향과
  // OrbitControls의 내부 회전 계산 기준이 어긋나서 두 손가락 회전이
  // 이상하게 멈추거나 꼬이는 문제가 생긴다. camera.up은 항상 월드 Z로
  // 고정해두고, 위치·바라보는 방향만 평면에 맞춘다.
  // keepZoom: 지금 확대/축소 거리 유지. keepPan: 지금 보고 있는 위치(평면 위로 내린 점)를 유지.
  function snapCameraFlat(plane: PlaneData, opts: { keepZoom?: boolean; keepPan?: boolean } = {}) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { origin, normal } = planeBasis(plane);
    const dist = opts.keepZoom ? camera.position.distanceTo(controls.target) : FLAT_DISTANCE;
    const target = opts.keepPan
      ? controls.target.clone().sub(normal.clone().multiplyScalar(normal.dot(controls.target.clone().sub(origin))))
      : origin.clone();
    camera.position.copy(target.clone().add(normal.clone().multiplyScalar(dist)));
    camera.up.set(0, 0, 1);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  }

  // 뷰 버튼: 스케치 안에서는 처음 정면 뷰로, 오버뷰에서는 처음 비스듬한 뷰로
  // 돌아간다. 확대/축소 상태는 그대로 유지한다.
  function resetView() {
    if (mode === "sketch" && activePlane) {
      snapCameraFlat(activePlane, { keepZoom: true });
      return;
    }
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dist = camera.position.distanceTo(controls.target);
    controls.target.set(0, 0, 0);
    camera.position.copy(new THREE.Vector3(1.9, 2.5, 1.6).normalize().multiplyScalar(dist));
    camera.up.set(0, 0, 1);
    camera.lookAt(controls.target);
    controls.update();
  }

  // ── 스케치 진입/이탈 ────────────────────────────────────────────
  // 스케치에 들어가면 항상 "선택" 도구(마우스 커서)로 시작한다.
  function enterSketch(plane: PlaneData, sketch: SketchData) {
    stopConnect();
    setPlaneTool(null);
    cancelShape();
    clearActiveGeometry();
    undoStackRef.current = [];
    for (const p of sketch.points) activePointsRef.current.set(p.id, p);
    for (const e of sketch.edges) activeEdgesRef.current.set(e.id, e);
    // 예전에 드래그로 그은 직선은 끝점이 숨겨져 저장돼 있다 — 직선(선분 하나짜리 획)의
    // 양끝은 항상 점으로 보여서 끌어 수정할 수 있게 한다.
    for (const [key, group] of groupByStroke(sketch.edges)) {
      if (group.length !== 1 || key.startsWith(RECT_PREFIX) || key.startsWith(CIRCLE_PREFIX)) continue;
      for (const id of [group[0].fromId, group[0].toId]) {
        const p = activePointsRef.current.get(id);
        if (p && p.isVertex === false) activePointsRef.current.set(id, { ...p, isVertex: true });
      }
    }
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
    // 사각형은 네 변 중 아래 가로변·오른쪽 세로변에만 치수를 단다.
    const rectLabelIds = new Set<string>();
    for (const [key, edges] of groupByStroke(activeEdgesRef.current.values())) {
      if (!key.startsWith(RECT_PREFIX)) continue;
      for (const id of rectLabelEdgeIds(plane, edges, activePointsRef.current) ?? []) {
        rectLabelIds.add(id);
      }
    }
    for (const [, e] of activeEdgesRef.current) {
      if (e.showLabel === undefined) {
        const key = strokeKeyOf(e);
        const from = activePointsRef.current.get(e.fromId);
        const to = activePointsRef.current.get(e.toId);
        const single = (strokeSizes.get(key) ?? 1) === 1;
        const visibleEnds = from?.isVertex !== false && to?.isVertex !== false;
        if (key.startsWith(CIRCLE_PREFIX)) e.showLabel = false;
        else if (key.startsWith(RECT_PREFIX) && (strokeSizes.get(key) ?? 0) === 4) {
          e.showLabel = rectLabelIds.has(e.id);
        } else e.showLabel = single || visibleEnds;
      }
      addActiveEdgeLine(e, e.showLabel);
    }
    rebuildShapeLabels(plane);
    syncCounts();
    dirtyRef.current = false;

    setActivePlaneId(plane.id);
    setActiveSketchId(sketch.id);
    setMode("sketch");
    setTool("select");
    setSelectedPlaneId(null);
    setSelectedEdge(null);
    setPendingPerpEdge(null);
    setSelectedPointId(null);
    setSelectedActiveEdgeId(null);
    snapCameraFlat(plane, { keepZoom: true }); // 확대/축소 상태는 유지
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
    cancelShape();
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
      enterSketch(plane, { id: sketch.id, name: sketch.name, points: [], edges: [] });
      router.refresh();
    } finally {
      setBusy(false);
    }
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
  // three r128의 Line2 레이캐스트(LineSegments2.raycast)는 w 성분을 잘못 넣는 버그가
  // 있어 굵은 선을 거의 못 잡는다. 선 양끝을 화면에 투영해 픽셀 거리로 직접 고른다.
  function pickNearestSegment<T>(
    clientX: number,
    clientY: number,
    segs: Iterable<[T, THREE.Vector3, THREE.Vector3]>
  ): T | null {
    const maxPx = lastPointerTypeRef.current === "touch" ? PICK_PX_TOUCH : PICK_PX_MOUSE;
    let best: T | null = null;
    let bestD = maxPx;
    for (const [key, a3, b3] of segs) {
      const a = toScreen(a3);
      const b = toScreen(b3);
      if (!a || !b) continue;
      const { dist } = distToSegment2D({ x: clientX, y: clientY }, a, b);
      if (dist < bestD) {
        bestD = dist;
        best = key;
      }
    }
    return best;
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
    // 선이 평면 카드 위를 지나가도 선이 먼저 선택되게 한다
    // (카드가 먼저 잡히면 선 대신 새 스케치가 만들어져 버렸다).
    const edgeObj = pickNearestSegment(
      clientX,
      clientY,
      (refGeometryGroupRef.current?.children ?? [])
        .filter((o) => o.userData.kind === "edge")
        .map((o): [THREE.Object3D, THREE.Vector3, THREE.Vector3] => [
          o,
          vecMm(o.userData.from),
          vecMm(o.userData.to),
        ])
    );
    if (edgeObj) {
      setSelectedEdge({
        edgeId: edgeObj.userData.edgeId,
        sketchId: edgeObj.userData.sketchId,
        from: edgeObj.userData.from,
        to: edgeObj.userData.to,
      });
      setSelectedPlaneId(null);
      return;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(planeCardGroupRef.current?.children ?? [], false);
    setSelectedEdge(null);
    if (hits.length === 0) {
      setSelectedPlaneId(null);
      return;
    }
    if (!allowPlane) return;
    const plane = planes.find((p) => p.id === hits[0].object.userData.planeId);
    if (plane && !busy) setSelectedPlaneId(plane.id);
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

  // 자유곡선 내부 점은 아주 촘촘하게 샘플링되므로 넓은 반경으로 병합하면
  // 곡선이 자기 자신과 계속 붙어서 각지게 보인다 — 그래서 3mm만 쓴다.
  // 그 밖의 "붙기"는 모두 화면 픽셀 기준 자석 스냅(findObjectSnap)이 맡는다.
  const FREEHAND_NEARBY_THRESHOLD = 0.003; // scene 단위 ≈ 3mm
  const EXACT_POINT_THRESHOLD = 0.0005; // scene 단위 ≈ 0.5mm, 같은 자리의 점 재사용

  // 화면 픽셀 거리를 이 위치에서의 scene 거리로 바꾼다(확대할수록 작아짐).
  function snapThresholdScene(at: THREE.Vector3) {
    const camera = cameraRef.current;
    const mount = mountRef.current;
    if (!camera || !mount) return 0.05;
    const d = camera.position.distanceTo(at);
    const perPx = (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, mount.clientHeight);
    const px = lastPointerTypeRef.current === "touch" ? SNAP_PX_TOUCH : SNAP_PX_MOUSE;
    return px * perPx;
  }

  function findNearbyActivePoint(
    pos: THREE.Vector3,
    threshold = snapThresholdScene(pos),
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

  // ── 자석 스냅: 원점·끝점·중점·원 중심·교차점 → 없으면 선 위 ──────────
  // exclude: 지금 끌고 있는 점(들). 자기 자신이나 자기 선에 붙지 않게 뺀다.
  function findObjectSnap(raw: THREE.Vector3, exclude?: Set<string>): SnapHit | null {
    if (!activePlane) return null;
    const th = snapThresholdScene(raw);
    const acc: { best: SnapHit | null; d: number } = { best: null, d: th };
    const consider = (pos: THREE.Vector3, kind: SnapKind, pointId?: string) => {
      const d = raw.distanceTo(pos);
      if (d < acc.d) {
        acc.d = d;
        acc.best = { pos: pos.clone(), kind, pointId };
      }
    };

    const points = activePointsRef.current;
    const edges = [...activeEdgesRef.current.values()];
    const degree = new Map<string, number>();
    const strokeSizes = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1);
      degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1);
      const k = strokeKeyOf(e);
      strokeSizes.set(k, (strokeSizes.get(k) ?? 0) + 1);
    }
    const skipEdge = (e: EdgeRec) => !!exclude && (exclude.has(e.fromId) || exclude.has(e.toId));

    consider(vecMm(sketchOriginMm(activePlane)), "origin");
    for (const [id, p] of points) {
      if (exclude?.has(id)) continue;
      if (p.isVertex === false && degree.get(id) !== 1) continue;
      consider(vecMm(p), "end", id);
    }
    for (const [key, group] of groupByStroke(edges)) {
      if (!key.startsWith(CIRCLE_PREFIX) || group.some(skipEdge)) continue;
      const ci = circleInfo(group, points);
      if (ci) consider(vecMm(ci.center), "center");
    }
    for (const e of edges) {
      if (skipEdge(e) || !isStraightEdge(e, points, strokeSizes)) continue;
      const a = points.get(e.fromId);
      const b = points.get(e.toId);
      if (a && b) consider(vecMm(a).add(vecMm(b)).multiplyScalar(0.5), "mid");
    }
    for (const r of otherSnapRefs?.points ?? []) consider(r.pos, r.kind);
    if (acc.best) return acc.best;

    for (const e of edges) {
      if (skipEdge(e)) continue;
      const a = points.get(e.fromId);
      const b = points.get(e.toId);
      if (a && b) consider(closestPointOnSegment(raw, vecMm(a), vecMm(b)), "on");
    }
    for (const [a, b] of otherSnapRefs?.segs ?? []) consider(closestPointOnSegment(raw, a, b), "on");
    return acc.best;
  }

  // 자석 스냅이 있으면 그 자리, 없으면 격자 스냅(+필요하면 수평·수직 스냅).
  function resolveTarget(
    raw: THREE.Vector3,
    opts: { ortho?: boolean; orthoRef?: THREE.Vector3; exclude?: Set<string> } = {}
  ): { pos: THREE.Vector3; hit: SnapHit | null } {
    const hit = findObjectSnap(raw, opts.exclude);
    if (hit) return { pos: hit.pos, hit };
    const grid = applySnap(raw);
    return { pos: opts.ortho ? applyOrthoSnap(grid, opts.orthoRef) : grid, hit: null };
  }

  // 붙는 자리에 주황 점 + "끝점/중점…" 이름표를 잠깐 보여준다.
  function showSnapMarker(hit: SnapHit | null) {
    if (!hit) {
      hideSnapMarker();
      return;
    }
    if (!snapMarkerRef.current) {
      const dot = makeDot(hit.pos, SELECT_COLOR, 12);
      previewGroupRef.current?.add(dot);
      snapMarkerRef.current = dot;
    } else {
      snapMarkerRef.current.position.copy(hit.pos);
    }
    if (!snapLabelRef.current) {
      const outer = document.createElement("div");
      const inner = createLabelDiv("");
      inner.style.transform = "translate(34px, -14px)";
      inner.style.color = "#c2410c";
      inner.style.borderColor = "rgba(194, 65, 12, 0.4)";
      outer.appendChild(inner);
      const label = new CSS2DObject(outer);
      previewGroupRef.current?.add(label);
      snapLabelRef.current = label;
    }
    snapLabelRef.current.position.copy(hit.pos);
    const inner = snapLabelRef.current.element.firstChild as HTMLElement | null;
    if (inner) inner.textContent = SNAP_LABEL[hit.kind];
  }
  function hideSnapMarker() {
    if (snapMarkerRef.current) {
      previewGroupRef.current?.remove(snapMarkerRef.current);
      snapMarkerRef.current.geometry.dispose();
      (snapMarkerRef.current.material as THREE.Material).dispose();
      snapMarkerRef.current = null;
    }
    if (snapLabelRef.current) {
      previewGroupRef.current?.remove(snapLabelRef.current);
      snapLabelRef.current = null;
    }
  }

  // 점 하나를 찍고(같은 자리 점이 있으면 그 점 사용), 이전 점이 있으면 선까지 잇는다.
  // 마우스 클릭과 키보드 치수 입력(Enter) 양쪽에서 공용으로 쓴다.
  // showLabel=false면 치수 라벨을 안 붙인다 (자유곡선을 잘게 쪼갠 구간용).
  // showPoint=false면 점(구슬) 표시를 안 한다 (자유곡선 중간 보간점, 드래그로 그은 선의 끝점).
  function commitDrawPoint(
    target: THREE.Vector3,
    showLabel = true,
    showPoint = true,
    reuseId: string | null = null,
    nearbyThreshold = EXACT_POINT_THRESHOLD
  ) {
    // 이어지는 선이 없는 상태(새 선의 시작)면 새 획 id를 만든다.
    if (!lastPointIdRef.current) currentStrokeIdRef.current = crypto.randomUUID();
    let pointId =
      reuseId && activePointsRef.current.has(reuseId)
        ? reuseId
        : findNearbyActivePoint(target, nearbyThreshold);
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

  // 자석 스냅(기존 점·원점·선 등)을 격자·직교 스냅보다 항상 우선한다.
  // 그래야 도형을 닫으려고 첫 점 근처를 찍었을 때 정확히 물린다.
  // ortho=true면 직전 점 기준 수평·수직 스냅도 건다.
  function commitDrawPointFromRaw(
    raw: THREE.Vector3,
    ortho = true,
    showLabel = true,
    showPoint = true
  ) {
    const { pos, hit } = resolveTarget(raw, { ortho: ortho && !!lastPointIdRef.current });
    commitDrawPoint(pos, showLabel, showPoint, hit?.pointId ?? null);
  }

  // 자유곡선 그대로 그린 궤적을 여러 짧은 직선(점 여러 개)으로 커밋한다.
  // 1mm 이상 떨어진 점만 남겨서 곡선의 세밀한 모양을 최대한 유지한다.
  // 시작·끝점만 자석 스냅을 받고(도형 닫기), 중간 점은 3mm 반경으로만 병합한다.
  // 조각마다 치수 라벨·점은 붙이지 않는다 — 손그림 느낌에는 어울리지 않는다.
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
    simplified.forEach((p, i) => {
      if (i === 0 || i === simplified.length - 1) commitDrawPointFromRaw(p, false, false, false);
      else commitDrawPoint(p, false, false, null, FREEHAND_NEARBY_THRESHOLD);
    });
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
      hidePreviewLine();
      return;
    }
    const fromVec = vecMm(from);
    const { pos: snappedRaw, hit } = resolveTarget(raw, { ortho: true, orthoRef: fromVec });
    showSnapMarker(hit);

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

    setPreviewLine(fromVec, target);
    const lengthMm = hasTyped ? Math.round(typed) : sceneToMm(fromVec.distanceTo(target));
    setPreviewLabel(
      fromVec.clone().add(target).multiplyScalar(0.5),
      hasTyped ? `${lengthMm}mm ▎키보드 입력 중 (Enter)` : `${lengthMm}mm`
    );
  }
  function setPreviewLine(a: THREE.Vector3, b: THREE.Vector3) {
    if (!previewLineRef.current) {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mat = new THREE.LineDashedMaterial({
        color: SELECT_COLOR,
        dashSize: 0.08,
        gapSize: 0.05,
      });
      const line = new THREE.Line(geo, mat);
      previewGroupRef.current?.add(line);
      previewLineRef.current = line;
    } else {
      const posAttr = previewLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, a.x, a.y, a.z);
      posAttr.setXYZ(1, b.x, b.y, b.z);
      posAttr.needsUpdate = true;
    }
    previewLineRef.current.computeLineDistances();
  }
  function setPreviewLabel(pos: THREE.Vector3, text: string) {
    if (!previewLabelRef.current) {
      const label = new CSS2DObject(createLabelDiv(""));
      previewGroupRef.current?.add(label);
      previewLabelRef.current = label;
    }
    previewLabelRef.current.position.copy(pos);
    previewLabelRef.current.element.textContent = text;
  }
  function hidePreviewLine() {
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
  }
  function hideDrawPreview() {
    clearErasePreview();
    hidePreviewLine();
    lastPreviewDirRef.current = null;
    clearTypedLength();
    strokeActiveRef.current = false;
    strokeRawPointsRef.current = [];
    strokeStraightModeRef.current = false;
    clearHoldTimeout();
    hideFreehandPreview();
    hideShapePreview();
    hideSnapMarker();
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
  // 직선 모드면 시작~현재 두 점을 스냅된 위치로 잇고 길이도 보여준다.
  function updateFreehandPreview() {
    const pts = strokeRawPointsRef.current;
    if (pts.length < 2) return;
    let renderPts = pts;
    if (strokeStraightModeRef.current) {
      const start = resolveTarget(pts[0]).pos;
      const end = resolveTarget(pts[pts.length - 1], { ortho: true, orthoRef: start }).pos;
      renderPts = [start, end];
      setPreviewLabel(start.clone().add(end).multiplyScalar(0.5), `${sceneToMm(start.distanceTo(end))}mm`);
    }
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

  // ── 사각형·원 그리기 ─────────────────────────────────────────────
  function setShapeDims(next: { a: string; b: string; field: 0 | 1 }) {
    shapeDimsRef.current = next;
    setShapeDimsState(next);
  }
  function cancelShape() {
    shapeStartRef.current = null;
    shapeStartedThisDownRef.current = false;
    lastShapeEndRef.current = null;
    setShapePending(false);
    setShapeDims({ a: "", b: "", field: 0 });
    hideShapePreview();
  }
  function beginShape(start: THREE.Vector3) {
    shapeStartRef.current = start.clone();
    lastShapeEndRef.current = null;
    setShapePending(true);
    setShapeDims({ a: "", b: "", field: 0 });
  }

  // 첫 점과 현재 점(+직접 입력한 치수)으로 사각형/원 모양을 계산한다.
  // 치수를 입력했으면 방향(부호)만 커서에서 가져오고 크기는 입력값을 쓴다.
  function computeShape(end: THREE.Vector3 | null) {
    const start = shapeStartRef.current;
    if (!start || !activePlane) return null;
    const endPos = end ?? start;
    const dims = shapeDimsRef.current;
    const a = parseFloat(dims.a);
    const b = parseFloat(dims.b);
    if (tool === "rect") {
      const s = toLocalUV(activePlane, start);
      const e = toLocalUV(activePlane, endPos);
      let w = e.u - s.u;
      let h = e.v - s.v;
      if (a > 0) w = (w < 0 ? -1 : 1) * mmToScene(a);
      if (b > 0) h = (h < 0 ? -1 : 1) * mmToScene(b);
      const uv = [
        [s.u, s.v],
        [s.u + w, s.v],
        [s.u + w, s.v + h],
        [s.u, s.v + h],
      ];
      const corners = uv.map(([u, v]) => fromLocalUV(activePlane, u, v));
      return { kind: "rect" as const, corners, wMm: Math.abs(sceneToMm(w)), hMm: Math.abs(sceneToMm(h)) };
    }
    if (tool === "circle") {
      const r = a > 0 ? mmToScene(a / 2) : start.distanceTo(endPos);
      const { uAxis, vAxis } = planeBasis(activePlane);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const t = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        pts.push(
          start
            .clone()
            .add(uAxis.clone().multiplyScalar(Math.cos(t) * r))
            .add(vAxis.clone().multiplyScalar(Math.sin(t) * r))
        );
      }
      return { kind: "circle" as const, center: start.clone(), points: pts, r, dMm: sceneToMm(r * 2) };
    }
    return null;
  }

  function updateShapePreview(end: THREE.Vector3 | null) {
    const g = computeShape(end);
    if (!g) {
      hideShapePreview();
      return;
    }
    const loopPts = g.kind === "rect" ? g.corners : g.points;
    if (!shapePreviewRef.current) {
      const mat = new THREE.LineDashedMaterial({ color: SELECT_COLOR, dashSize: 0.04, gapSize: 0.025 });
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(loopPts), mat);
      previewGroupRef.current?.add(loop);
      shapePreviewRef.current = loop;
    } else {
      shapePreviewRef.current.geometry.dispose();
      shapePreviewRef.current.geometry = new THREE.BufferGeometry().setFromPoints(loopPts);
    }
    shapePreviewRef.current.computeLineDistances();

    const dims = shapeDimsRef.current;
    const mark = (field: 0 | 1, has: boolean) => (dims.field === field && has ? " ▎" : "");
    const labels: { pos: THREE.Vector3; text: string }[] =
      g.kind === "rect"
        ? [
            {
              pos: g.corners[0].clone().add(g.corners[1]).multiplyScalar(0.5),
              text: `가로 ${g.wMm}mm${mark(0, !!dims.a)}`,
            },
            {
              pos: g.corners[1].clone().add(g.corners[2]).multiplyScalar(0.5),
              text: `세로 ${g.hMm}mm${mark(1, !!dims.b)}`,
            },
          ]
        : [
            {
              pos: g.points[0].clone(),
              text: `Ø${g.dMm}mm${dims.a ? " ▎" : ""}`,
            },
          ];
    while (shapePreviewLabelsRef.current.length > labels.length) {
      previewGroupRef.current?.remove(shapePreviewLabelsRef.current.pop()!);
    }
    labels.forEach((l, i) => {
      let obj = shapePreviewLabelsRef.current[i];
      if (!obj) {
        obj = new CSS2DObject(createLabelDiv(""));
        previewGroupRef.current?.add(obj);
        shapePreviewLabelsRef.current[i] = obj;
      }
      obj.position.copy(l.pos);
      obj.element.textContent = l.text;
    });
  }
  function hideShapePreview() {
    if (shapePreviewRef.current) {
      previewGroupRef.current?.remove(shapePreviewRef.current);
      shapePreviewRef.current.geometry.dispose();
      (shapePreviewRef.current.material as THREE.Material).dispose();
      shapePreviewRef.current = null;
    }
    for (const l of shapePreviewLabelsRef.current) previewGroupRef.current?.remove(l);
    shapePreviewLabelsRef.current = [];
  }

  // 사각형: 꼭짓점 4개(점 표시) + 변 4개, 치수는 아래 가로변·오른쪽 세로변에.
  // 원: 72각형(점 표시 없음), 지름 치수 라벨 하나. 획 id 앞에 도형 종류를 붙인다.
  function commitShape(end: THREE.Vector3 | null) {
    const g = computeShape(end);
    if (!g) return;
    if (g.kind === "rect" && (g.wMm < 1 || g.hMm < 1)) return;
    if (g.kind === "circle" && g.dMm < 2) return;
    pushUndoSnapshot();
    const strokeId = (g.kind === "rect" ? RECT_PREFIX : CIRCLE_PREFIX) + crypto.randomUUID();
    const loopPts = g.kind === "rect" ? g.corners : g.points;
    const showPoint = g.kind === "rect";
    const ids = loopPts.map((pos) => {
      const id = `tmp_${crypto.randomUUID()}`;
      const rec: PointRec = {
        id,
        x: sceneToMm(pos.x),
        y: sceneToMm(pos.y),
        z: sceneToMm(pos.z),
        isVertex: showPoint,
      };
      activePointsRef.current.set(id, rec);
      if (showPoint) addActivePointMesh(id, rec);
      return id;
    });
    const edges: EdgeRec[] = ids.map((fromId, i) => ({
      id: `tmp_${crypto.randomUUID()}`,
      fromId,
      toId: ids[(i + 1) % ids.length],
      strokeId,
    }));
    const labelIds =
      g.kind === "rect" && activePlane
        ? rectLabelEdgeIds(activePlane, edges, activePointsRef.current)
        : null;
    for (const e of edges) {
      e.showLabel = !!labelIds?.has(e.id);
      activeEdgesRef.current.set(e.id, e);
      addActiveEdgeLine(e, e.showLabel);
    }
    if (g.kind === "circle") rebuildShapeLabels();
    lastPointIdRef.current = null;
    syncCounts();
    dirtyRef.current = true;
    cancelShape();
  }

  // ── 키보드로 치수 직접 입력 (그리는 중, 숫자 입력 후 Enter) ──────
  function clearTypedLength() {
    typedLengthRef.current = "";
    setTypedLength("");
  }
  function handleDrawKeyDown(e: KeyboardEvent) {
    if (mode !== "sketch" || tool !== "line" || !lastPointIdRef.current) return;
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
  // 사각형: 숫자 → 가로, Tab 또는 쉼표로 세로 칸으로, Enter 확정. 원: 숫자 → 지름.
  function handleShapeKeyDown(e: KeyboardEvent): boolean {
    if (mode !== "sketch" || (tool !== "rect" && tool !== "circle") || !shapeStartRef.current) {
      return false;
    }
    const dims = { ...shapeDimsRef.current };
    const key = dims.field === 0 ? "a" : "b";
    if (/^[0-9.]$/.test(e.key)) {
      dims[key] += e.key;
    } else if (e.key === "Backspace") {
      e.preventDefault();
      dims[key] = dims[key].slice(0, -1);
    } else if ((e.key === "Tab" || e.key === ",") && tool === "rect") {
      e.preventDefault();
      dims.field = dims.field === 0 ? 1 : 0;
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitShape(lastShapeEndRef.current);
      return true;
    } else {
      return false;
    }
    setShapeDims(dims);
    updateShapePreview(lastShapeEndRef.current);
    return true;
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

  // 선을 그을 때 기준점(없으면 마지막 점, 그것도 없으면 스케치 원점) 기준으로
  // 수평·수직에 가까우면 딱 맞춰주는 마그네틱 스냅.
  function applyOrthoSnap(target: THREE.Vector3, ref?: THREE.Vector3): THREE.Vector3 {
    if (!activePlane) return target;
    const last = lastPointIdRef.current
      ? activePointsRef.current.get(lastPointIdRef.current)
      : null;
    const refVec = ref ?? (last ? vecMm(last) : vecMm(sketchOriginMm(activePlane)));
    const refUV = toLocalUV(activePlane, refVec);
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
    if (selectedPointId) {
      const id = selectedPointId;
      const edgeIds = [...activeEdgesRef.current.values()]
        .filter((e) => e.fromId === id || e.toId === id)
        .map((e) => e.id);
      removeActivePointMesh(id);
      activePointsRef.current.delete(id);
      removeEdgesAndOrphans(edgeIds);
    } else if (selectedActiveEdgeId) {
      const target = activeEdgesRef.current.get(selectedActiveEdgeId);
      if (target) removeEdgesAndOrphans(strokeEdgeIds(strokeKeyOf(target)));
    }
    afterGeometryChanged();
    selectActivePoint(null);
  }

  function strokeEdgeIds(key: string) {
    return [...activeEdgesRef.current.values()].filter((e) => strokeKeyOf(e) === key).map((e) => e.id);
  }
  function removeEdgesAndOrphans(edgeIds: Iterable<string>) {
    const touched = new Set<string>();
    for (const eid of [...edgeIds]) {
      const e = activeEdgesRef.current.get(eid);
      if (!e) continue;
      touched.add(e.fromId);
      touched.add(e.toId);
      removeActiveEdgeLine(eid);
      activeEdgesRef.current.delete(eid);
    }
    const used = new Set<string>();
    for (const e of activeEdgesRef.current.values()) {
      used.add(e.fromId);
      used.add(e.toId);
    }
    for (const pid of touched) {
      if (used.has(pid)) continue;
      removeActivePointMesh(pid);
      activePointsRef.current.delete(pid);
    }
    if (lastPointIdRef.current && !activePointsRef.current.has(lastPointIdRef.current)) {
      lastPointIdRef.current = null;
    }
  }
  // 원을 지우면 Ø 라벨도 같이 없어져야 한다.
  function afterGeometryChanged() {
    rebuildShapeLabels();
    syncCounts();
    dirtyRef.current = true;
  }

  // ── 지우개 ──────────────────────────────────────────────────────
  // 커서 아래에서 지울 대상: 선분 id → 그 선분에서 지울 구간들.
  // 개체 지우개는 획 전체, 조각 지우개는 교차점 사이 조각.
  function eraseTargetAt(clientX: number, clientY: number) {
    const edgeId = pickActiveEdge(clientX, clientY);
    const e = edgeId ? activeEdgesRef.current.get(edgeId) : undefined;
    if (!edgeId || !e) return null;
    const cached = erasePreviewCacheRef.current;
    if (tool === "eraseObj") {
      if (cached?.has(edgeId)) return cached;
      const removed = new Map(strokeEdgeIds(strokeKeyOf(e)).map((id): [string, [number, number][]] => [id, [[0, 1]]]));
      erasePreviewCacheRef.current = removed;
      return removed;
    }
    const raw = raycastToActivePlane(clientX, clientY);
    const a = activePointsRef.current.get(e.fromId);
    const b = activePointsRef.current.get(e.toId);
    if (!raw || !a || !b || !activePlane) return null;
    const ivs = cached?.get(edgeId);
    if (ivs) {
      const av = vecMm(a);
      const ab = vecMm(b).sub(av);
      const t = ab.lengthSq() > 1e-12 ? raw.clone().sub(av).dot(ab) / ab.lengthSq() : 0.5;
      if (ivs.some(([t0, t1]) => t >= t0 - T_EPS && t <= t1 + T_EPS)) return cached!;
    }
    const removed = computeTrimPiece(
      activePlane,
      activePointsRef.current,
      activeEdgesRef.current,
      otherSnapRefs?.segs ?? [],
      edgeId,
      raw
    );
    erasePreviewCacheRef.current = removed;
    return removed;
  }

  function showErasePreview(removed: Map<string, [number, number][]> | null) {
    if (erasePreviewRef.current?.userData.removed === removed && removed) return;
    clearErasePreviewLine();
    if (!removed) return;
    const pos: number[] = [];
    for (const [id, ivs] of removed) {
      const e = activeEdgesRef.current.get(id);
      const a = e && activePointsRef.current.get(e.fromId);
      const b = e && activePointsRef.current.get(e.toId);
      if (!a || !b) continue;
      const av = vecMm(a);
      const bv = vecMm(b);
      for (const [t0, t1] of ivs) {
        const p = av.clone().lerp(bv, t0);
        const q = av.clone().lerp(bv, t1);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    }
    if (pos.length === 0) return;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const mat = new LineMaterial({ color: ERASE_COLOR, linewidth: 4.5, resolution: lineResolutionRef.current });
    mat.depthTest = false;
    const obj = new LineSegments2(geo, mat);
    obj.renderOrder = 5;
    obj.userData.removed = removed;
    previewGroupRef.current?.add(obj);
    erasePreviewRef.current = obj;
  }
  function clearErasePreviewLine() {
    const obj = erasePreviewRef.current;
    if (!obj) return;
    previewGroupRef.current?.remove(obj);
    obj.geometry.dispose();
    obj.material.dispose();
    erasePreviewRef.current = null;
  }
  function clearErasePreview() {
    clearErasePreviewLine();
    erasePreviewCacheRef.current = null;
  }

  // 지울 구간을 실제로 지운다. 선분 중간이 잘리면 잘린 자리에 새 끝점을 만들고,
  // 남은 부분이 여러 덩어리로 나뉘면 각각 따로 선택·삭제되는 별개의 획이 된다.
  function applyErase(removed: Map<string, [number, number][]>) {
    const edges = activeEdgesRef.current;
    const pts = activePointsRef.current;
    const firstId = removed.keys().next().value;
    const first = firstId ? edges.get(firstId) : undefined;
    if (!first) return;
    const key = strokeKeyOf(first);
    const strokeEdges = [...edges.values()].filter((e) => strokeKeyOf(e) === key);
    const strokeSizes = new Map([[key, strokeEdges.length]]);
    const straight = new Map(strokeEdges.map((e) => [e.id, isStraightEdge(e, pts, strokeSizes)]));

    const newEdges: EdgeRec[] = [];
    const cutPoints = new Map<string, string>();
    for (const [id, ivs] of removed) {
      const e = edges.get(id);
      const a = e && pts.get(e.fromId);
      const b = e && pts.get(e.toId);
      if (!e || !a || !b) continue;
      const av = vecMm(a);
      const bv = vecMm(b);
      const len = av.distanceTo(bv);
      const isStraight = straight.get(id) ?? true;
      const pointAt = (t: number) => {
        if (t <= T_EPS) return e.fromId;
        if (t >= 1 - T_EPS) return e.toId;
        const pos = av.clone().lerp(bv, t);
        const ck = `${sceneToMm(pos.x)},${sceneToMm(pos.y)},${sceneToMm(pos.z)}`;
        const known = cutPoints.get(ck) ?? findNearbyActivePoint(pos, EXACT_POINT_THRESHOLD);
        if (known) {
          cutPoints.set(ck, known);
          return known;
        }
        const pid = `tmp_${crypto.randomUUID()}`;
        const rec: PointRec = {
          id: pid,
          x: sceneToMm(pos.x),
          y: sceneToMm(pos.y),
          z: sceneToMm(pos.z),
          isVertex: isStraight,
        };
        pts.set(pid, rec);
        if (isStraight) addActivePointMesh(pid, rec);
        cutPoints.set(ck, pid);
        return pid;
      };
      // 0.5mm보다 짧게 남는 자투리는 버린다
      for (const [k0, k1] of keptIntervals(ivs, len > 0 ? 0.0005 / len : 1)) {
        const f = pointAt(k0);
        const t = pointAt(k1);
        if (f !== t) newEdges.push({ id: `tmp_${crypto.randomUUID()}`, fromId: f, toId: t, showLabel: isStraight, strokeId: key });
      }
    }
    // 새 선을 먼저 넣어둬야 그 끝점이 "안 쓰는 점"으로 지워지지 않는다
    for (const ne of newEdges) edges.set(ne.id, ne);
    removeEdgesAndOrphans(removed.keys());

    // 남은 선들을 이어진 덩어리별로 새 획으로 나눈다. 잘린 사각형·원은 더 이상
    // 사각형·원이 아니므로 rect:/circle: 표시를 뗀다.
    const remaining = [...edges.values()].filter((e) => strokeKeyOf(e) === key);
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x);
      if (!p || p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    for (const e of remaining) parent.set(find(e.fromId), find(e.toId));
    const strokeOfRoot = new Map<string, string>();
    for (const e of remaining) {
      const root = find(e.fromId);
      let sid = strokeOfRoot.get(root);
      if (!sid) {
        sid = crypto.randomUUID();
        strokeOfRoot.set(root, sid);
      }
      removeActiveEdgeLine(e.id);
      const rec: EdgeRec = { ...e, strokeId: sid, showLabel: straight.get(e.id) ?? e.showLabel };
      edges.set(rec.id, rec);
      addActiveEdgeLine(rec, !!rec.showLabel);
    }
    clearErasePreview();
    afterGeometryChanged();
  }

  function eraseAt(g: NonNullable<typeof eraseGestureRef.current>, clientX: number, clientY: number) {
    const removed = eraseTargetAt(clientX, clientY);
    if (!removed) return;
    if (!g.snapshotPushed) {
      pushUndoSnapshot();
      g.snapshotPushed = true;
    }
    applyErase(removed);
  }
  // 문지르는 동안 빠르게 움직여도 가는 선을 건너뛰지 않게 4px 간격으로 훑는다.
  function eraseAlong(g: NonNullable<typeof eraseGestureRef.current>, x0: number, y0: number, x1: number, y1: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let i = 1; i <= n; i++) eraseAt(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
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
    cancelStrokeDrag();
    eraseGestureRef.current = null;
    clearErasePreviewLine();
    if (strokeActiveRef.current) {
      strokeActiveRef.current = false;
      strokeRawPointsRef.current = [];
      strokeStraightModeRef.current = false;
      clearHoldTimeout();
      hideFreehandPreview();
      hidePreviewLine();
    }
    // 방금 누른 손가락으로 시작한 사각형/원은 취소(탭으로 첫 점만 찍어둔 상태는 유지)
    if (shapeStartedThisDownRef.current) cancelShape();
    hideSnapMarker();
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
    lastPointerTypeRef.current = e.pointerType;
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

    if (mode !== "sketch") return;
    const raw = raycastToActivePlane(e.clientX, e.clientY);
    if (!raw) return;
    if (tool === "select") {
      // 화면에 보이는 꼭짓점만 잡는다. 자유곡선 내부 보간점을 잡으면
      // 곡선에서 뾰족하게 한 점만 튀어나오는 문제가 생긴다.
      const pointId = findNearbyActivePoint(raw, undefined, true);
      if (pointId) {
        pushUndoSnapshot();
        draggingPointIdRef.current = pointId;
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const edgeId = pickActiveEdge(e.clientX, e.clientY);
      if (edgeId) {
        startStrokeDrag(edgeId, raw);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } else if (tool === "free" || (tool === "line" && !chainMode)) {
      // 매번 새로운 독립된 선으로 시작한다 — 이전 선의 끝점에 자동으로
      // 이어붙지 않도록 체인을 끊는다(붙이고 싶으면 자석 스냅이 붙여준다).
      lastPointIdRef.current = null;
      strokeActiveRef.current = true;
      strokeRawPointsRef.current = [raw.clone()];
      strokeStraightModeRef.current = tool === "line";
      if (tool === "free") scheduleHoldTimeout();
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === "rect" || tool === "circle") {
      if (!shapeStartRef.current) {
        beginShape(resolveTarget(raw).pos);
        shapeStartedThisDownRef.current = true;
      } else {
        shapeStartedThisDownRef.current = false;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (isEraseTool(tool)) {
      eraseGestureRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        rubbing: false,
        snapshotPushed: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function handleActiveEdgeTap(clientX: number, clientY: number) {
    selectActiveEdge(pickActiveEdge(clientX, clientY));
  }

  function startStrokeDrag(edgeId: string, raw: THREE.Vector3) {
    const e = activeEdgesRef.current.get(edgeId);
    const from = e && activePointsRef.current.get(e.fromId);
    const to = e && activePointsRef.current.get(e.toId);
    if (!e || !from || !to) return;
    const key = strokeKeyOf(e);
    const orig = new Map<string, THREE.Vector3>();
    for (const se of activeEdgesRef.current.values()) {
      if (strokeKeyOf(se) !== key) continue;
      for (const id of [se.fromId, se.toId]) {
        const p = activePointsRef.current.get(id);
        if (p && !orig.has(id)) orig.set(id, vecMm(p));
      }
    }
    pushUndoSnapshot();
    strokeDragRef.current = {
      key,
      edgeId,
      grab: closestPointOnSegment(raw, vecMm(from), vecMm(to)),
      orig,
      labelOrig: activeShapeLabelsRef.current.get(key)?.position.clone() ?? null,
    };
    selectActiveEdge(edgeId);
  }
  // 잡은 자리 기준으로 옮긴다. 잡은 자리가 원점·끝점 등에 가까우면 거기에 붙는다(선 위는 제외).
  function dragStrokeTo(raw: THREE.Vector3) {
    const d = strokeDragRef.current;
    if (!d) return;
    const hit = findObjectSnap(raw, new Set(d.orig.keys()));
    const pointHit = hit && hit.kind !== "on" ? hit : null;
    showSnapMarker(pointHit);
    const target = pointHit ? pointHit.pos : applySnap(raw);
    moveStrokeBy(d, target.clone().sub(d.grab));
  }
  function moveStrokeBy(d: NonNullable<typeof strokeDragRef.current>, delta: THREE.Vector3) {
    for (const [id, o] of d.orig) {
      const rec = activePointsRef.current.get(id);
      if (!rec) continue;
      const pos = o.clone().add(delta);
      rec.x = sceneToMm(pos.x);
      rec.y = sceneToMm(pos.y);
      rec.z = sceneToMm(pos.z);
      activePointMeshesRef.current.get(id)?.position.copy(vecMm(rec));
    }
    refreshEdgesForPoint(new Set(d.orig.keys()));
    const label = activeShapeLabelsRef.current.get(d.key);
    if (label && d.labelOrig) label.position.copy(d.labelOrig.clone().add(delta));
  }
  function cancelStrokeDrag() {
    const d = strokeDragRef.current;
    if (!d) return;
    moveStrokeBy(d, new THREE.Vector3());
    undoStackRef.current.pop();
    strokeDragRef.current = null;
    hideSnapMarker();
  }

  function pickActiveEdge(clientX: number, clientY: number): string | null {
    const pts = activePointsRef.current;
    const segs: [string, THREE.Vector3, THREE.Vector3][] = [];
    for (const [id, e] of activeEdgesRef.current) {
      const a = pts.get(e.fromId);
      const b = pts.get(e.toId);
      if (a && b) segs.push([id, vecMm(a), vecMm(b)]);
    }
    return pickNearestSegment(clientX, clientY, segs);
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

    if (eraseGestureRef.current) {
      const g = eraseGestureRef.current;
      eraseGestureRef.current = null;
      // 거의 안 움직였으면 탭 — 누른 자리 하나만 지운다(오래 눌러도 마찬가지)
      if (!g.rubbing) eraseAt(g, e.clientX, e.clientY);
      if (e.pointerType !== "touch") showErasePreview(eraseTargetAt(e.clientX, e.clientY));
      return;
    }

    if (strokeDragRef.current) {
      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) cancelStrokeDrag(); // 거의 안 움직였으면 이동이 아니라 선택만(원위치)
      else {
        strokeDragRef.current = null;
        hideSnapMarker();
        dirtyRef.current = true;
      }
      return;
    }

    if (draggingPointIdRef.current) {
      const draggedId = draggingPointIdRef.current;
      draggingPointIdRef.current = null;
      hideSnapMarker();
      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) {
        undoStackRef.current.pop(); // 실제로 안 움직였으니 미리 찍어둔 스냅샷은 버린다
        selectActivePoint(draggedId); // 거의 안 움직였으면 이동이 아니라 "선택"으로 처리
      } else {
        dirtyRef.current = true;
      }
      return;
    }

    if (mode === "sketch" && (tool === "rect" || tool === "circle") && shapeStartRef.current) {
      const wasTap = !!down && isTap(down, { x: e.clientX, y: e.clientY });
      const startedNow = shapeStartedThisDownRef.current;
      shapeStartedThisDownRef.current = false;
      // 첫 점만 탭했으면 두 번째 점(대각선 꼭짓점/크기)을 기다린다.
      if (startedNow && wasTap) return;
      const raw = raycastToActivePlane(e.clientX, e.clientY);
      const end = raw ? resolveTarget(raw).pos : lastShapeEndRef.current;
      hideSnapMarker();
      commitShape(end);
      if (shapeStartRef.current) cancelShape(); // 크기가 0이라 안 그려졌으면 정리
      return;
    }

    if (mode === "sketch" && (tool === "free" || tool === "line") && strokeActiveRef.current) {
      strokeActiveRef.current = false;
      clearHoldTimeout();
      const rawPoints = strokeRawPointsRef.current;
      const wasStraight = strokeStraightModeRef.current;
      strokeRawPointsRef.current = [];
      strokeStraightModeRef.current = false;
      hideFreehandPreview();
      hidePreviewLine();
      hideSnapMarker();
      if (rawPoints.length === 0) return;

      const wasTap = down && isTap(down, { x: e.clientX, y: e.clientY });
      if (wasTap) {
        // 이어그리기가 꺼져 있으면 탭 한 번으로는 아무것도 그리지 않는다
        // (선으로 이어지지도 않는 외톨이 점만 남는 걸 막기 위해).
      } else if (wasStraight) {
        // 직선 도구 또는 1초 멈춤으로 전환 → 시작점~끝점 직선.
        // 양끝에 점을 표시해서 선택 도구로 끝점을 끌어 수정할 수 있게 한다.
        pushUndoSnapshot();
        commitDrawPointFromRaw(rawPoints[0], false, true, true);
        commitDrawPointFromRaw(rawPoints[rawPoints.length - 1], true, true, true);
      } else {
        // 자유곡선 그대로(삐뚤빼뚤 유지) → 궤적을 따라 여러 점으로 커밋
        pushUndoSnapshot();
        commitFreehandStroke(rawPoints);
      }
      // 이어그리기가 아니면 여기서 획이 끝난 것 — commitDrawPoint가 남겨둔
      // lastPointIdRef를 지워서 다음 마우스 이동에 고무줄 미리보기(점선)가
      // 안 따라오게 한다(다음 pointerDown에서도 다시 지우지만, 그 사이
      // 마우스만 움직여도 점선이 보이는 문제를 막기 위해 여기서도 지운다).
      lastPointIdRef.current = null;
      return;
    }

    if (!down) return;
    if (!isTap(down, { x: e.clientX, y: e.clientY })) return; // 드래그(회전)로 판단, 무시

    if (mode === "sketch") {
      if (tool === "line" && chainMode) handleDrawClick(e.clientX, e.clientY);
      else if (tool === "select") handleActiveEdgeTap(e.clientX, e.clientY);
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

    lastPointerTypeRef.current = e.pointerType;
    const toMm = (v: THREE.Vector3) => ({ x: sceneToMm(v.x), y: sceneToMm(v.y), z: sceneToMm(v.z) });

    if (strokeDragRef.current) {
      const raw = raycastToActivePlane(e.clientX, e.clientY);
      if (raw) dragStrokeTo(raw);
      return;
    }

    if (draggingPointIdRef.current) {
      const raw = raycastToActivePlane(e.clientX, e.clientY);
      if (!raw) return;
      const id = draggingPointIdRef.current;
      // 사각형 꼭짓점이면 직사각형을 유지하며 늘리고, 자기 도형에는 안 붙게 뺀다.
      const rect = rectOfPoint(id);
      const exclude = new Set(rect ? rect.corners.map((c) => c.id) : [id]);
      const hit = findObjectSnap(raw, exclude);
      showSnapMarker(hit);
      if (rect) moveRectCorner(rect, id, hit ? hit.pos : applySnap(raw));
      else if (hit) setPointPos(id, hit.pos);
      else movePointTo(id, raw);
      setCursorMm(toMm(hit ? hit.pos : raw));
      return;
    }

    if (tool === "select") return;

    if (isEraseTool(tool)) {
      const g = eraseGestureRef.current;
      if (!g) {
        // 마우스·펜을 올려두기만 하면 지워질 선을 빨갛게 미리 보여준다
        showErasePreview(eraseTargetAt(e.clientX, e.clientY));
      } else if (!g.rubbing) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_MAX_MOVE) {
          g.rubbing = true;
          clearErasePreviewLine();
          eraseAt(g, g.startX, g.startY);
          eraseAlong(g, g.startX, g.startY, e.clientX, e.clientY);
          g.lastX = e.clientX;
          g.lastY = e.clientY;
        }
      } else {
        eraseAlong(g, g.lastX, g.lastY, e.clientX, e.clientY);
        g.lastX = e.clientX;
        g.lastY = e.clientY;
      }
      return;
    }

    const raw = raycastToActivePlane(e.clientX, e.clientY);
    if (!raw) return;

    if (tool === "rect" || tool === "circle") {
      const { pos, hit } = resolveTarget(raw);
      showSnapMarker(hit);
      if (shapeStartRef.current) {
        lastShapeEndRef.current = pos;
        updateShapePreview(pos);
      }
      setCursorMm(toMm(pos));
      return;
    }

    if (strokeActiveRef.current) {
      strokeRawPointsRef.current.push(raw.clone());
      // 자유 그리기는 계속 움직이는 동안 멈춤 타이머를 계속 미룬다
      // (1초 이상 안 움직이면 그때 직선으로 전환됨)
      if (tool === "free" && !strokeStraightModeRef.current) scheduleHoldTimeout();
      updateFreehandPreview();
      showSnapMarker(findObjectSnap(raw));
      setCursorMm(toMm(raw));
      return;
    }

    if (lastPointIdRef.current) {
      updateDrawPreview(e.clientX, e.clientY);
    } else {
      showSnapMarker(findObjectSnap(raw));
    }
    setCursorMm(toMm(resolveTarget(raw, { ortho: !!lastPointIdRef.current }).pos));
  }

  function handleSetTool(next: Tool) {
    // 선택·지우개 → 그리기 도구로 바꿀 때만 평면 정면으로 카메라를 맞춘다
    // (그리기 도구끼리 바꿀 때는 보던 화면을 유지).
    // 확대 상태와 보던 위치는 유지하고 방향만 정면으로 돌린다.
    if (!isDrawTool(tool) && isDrawTool(next) && activePlane) {
      snapCameraFlat(activePlane, { keepZoom: true, keepPan: true });
    }
    setTool(next);
    cancelShape();
    lastPointIdRef.current = null;
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
    cancelShape();
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
        cancelShape();
        handleNewStroke();
        selectActivePoint(null);
        return;
      }
      // 사각형·원 치수 입력(숫자, Tab/쉼표, Backspace, Enter)
      if (handleShapeKeyDown(e)) return;
      if (e.key === "Delete" || (e.key === "Backspace" && tool === "select")) {
        e.preventDefault();
        handleDeleteSelection();
        return;
      }
      // 도구 단축키 V·P·L·R·C
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const def = TOOL_DEFS.find((t) => t.key === e.key.toLowerCase());
        if (def) {
          handleSetTool(def.id);
          return;
        }
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

  // 좌측 트리 — 캔버스 영역 위에 떠 있는 CATIA식 연결선 트리. 도구 막대·상태줄 아래에
  // 붙어 있어서 도구 막대가 두 줄로 늘어나도 글씨와 겹치지 않는다.
  const treePanel = (
      <div className="absolute top-2 left-3 z-10 w-64 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1rem)] flex flex-col rounded-lg border border-black/10 bg-white/90 backdrop-blur-sm shadow-lg">
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
  );

  return (
    <div className="fixed inset-0 bg-[#faf6ee] overflow-hidden">
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
                  className="ml-1 w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                  title="실행 취소 — 오버뷰에서 한 선 잇기/지우기를 되돌립니다 (Ctrl+Z)"
                  aria-label="실행 취소"
                >
                  <UndoIcon />
                </button>
              </div>
              <button
                onClick={resetView}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
                title="처음 보던 방향으로 되돌립니다 (확대/축소 상태는 유지)"
              >
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13" />
                  <rect x="7" y="7" width="6" height="6" />
                </svg>
                기본 뷰
              </button>

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
              <div className="flex items-center gap-0.5 rounded-lg border border-gray-300 bg-white p-0.5">
                {TOOL_DEFS.map((t) => (
                  <div key={t.id} className="flex items-center gap-0.5">
                    {t.id === "eraseObj" && <span className="w-px h-6 mx-0.5 bg-gray-200" />}
                    <button
                      onClick={() => handleSetTool(t.id)}
                      title={t.title}
                      aria-label={t.title}
                      aria-pressed={tool === t.id}
                      className={`w-9 h-9 flex items-center justify-center rounded-md ${
                        tool === t.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <ToolIcon kind={t.id} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={resetView}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
                title="스케치를 처음 정면 뷰로 되돌립니다 (확대/축소 상태는 유지)"
              >
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13" />
                  <rect x="7" y="7" width="6" height="6" />
                </svg>
                정면 뷰
              </button>

              {tool === "line" && (
                <label
                  className="flex items-center gap-1 text-xs text-gray-500 px-1"
                  title="켜면 탭으로 점을 찍어서 잇는 방식(오토캐드식)"
                >
                  <input
                    type="checkbox"
                    checked={chainMode}
                    onChange={(e) => {
                      setChainMode(e.target.checked);
                      handleNewStroke();
                    }}
                  />
                  이어그리기
                </label>
              )}

              {(tool === "rect" || tool === "circle") && shapePending && (
                <div className="flex items-center gap-1.5 text-xs bg-white border border-orange-300 rounded-md px-2.5 py-1">
                  {(tool === "rect"
                    ? ([
                        ["가로", 0],
                        ["세로", 1],
                      ] as const)
                    : ([["지름", 0]] as const)
                  ).map(([name, field]) => (
                    <label key={name} className="flex items-center gap-1 text-gray-500">
                      {name}
                      <input
                        type="number"
                        inputMode="decimal"
                        value={field === 0 ? shapeDims.a : shapeDims.b}
                        placeholder="자유"
                        onFocus={() => setShapeDims({ ...shapeDimsRef.current, field })}
                        onChange={(e) => {
                          const next = { ...shapeDimsRef.current, field };
                          if (field === 0) next.a = e.target.value;
                          else next.b = e.target.value;
                          setShapeDims(next);
                          updateShapePreview(lastShapeEndRef.current);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitShape(lastShapeEndRef.current);
                          if (e.key === "Escape") cancelShape();
                        }}
                        className={`w-16 border rounded px-1.5 py-1 ${
                          shapeDims.field === field ? "border-orange-400" : "border-gray-300"
                        }`}
                      />
                    </label>
                  ))}
                  <span className="text-gray-400">mm</span>
                  <button
                    onClick={() => commitShape(lastShapeEndRef.current)}
                    className="px-2 py-1 rounded bg-gray-900 text-white"
                  >
                    확정
                  </button>
                  <button onClick={cancelShape} className="px-2 py-1 rounded text-gray-400">
                    취소
                  </button>
                </div>
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

              {tool === "line" && chainMode && (
                <button
                  onClick={handleNewStroke}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600"
                >
                  새 선 시작
                </button>
              )}
              <button
                onClick={handleUndo}
                title="실행 취소 (Ctrl+Z)"
                aria-label="실행 취소"
                className="w-9 h-9 flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
              >
                <UndoIcon />
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
              {cursorMm && activePlane && (() => {
                // 스케치 원점(0,0) 기준 가로·세로 좌표
                const o = toLocalUV(activePlane, vecMm(sketchOriginMm(activePlane)));
                const c = toLocalUV(activePlane, vecMm(cursorMm));
                return (
                  <span>
                    커서: 가로 {sceneToMm(c.u - o.u)}, 세로 {sceneToMm(c.v - o.v)} mm
                  </span>
                );
              })()}
              <span>
                {tool === "select"
                  ? "점을 끌어서 이동(사각형은 모양 유지), 선을 탭하면 그 선(한 획) 전체가 선택됩니다. Delete 키로 지우기."
                  : tool === "eraseObj"
                  ? "선을 탭하거나 누른 채 문지르면 그 개체(한 획) 전체가 지워집니다 · 빨간색이 지워질 선"
                  : tool === "eraseSeg"
                  ? "선을 탭하거나 문지르면 교차점 사이 조각만 지워집니다 · 빨간색이 지워질 조각"
                  : tool === "free"
                    ? "누른 채 그으면 그대로 곡선 · 1초 멈추면 직선으로 바뀝니다 · 점·선·원점에 자석처럼 붙습니다"
                    : tool === "line"
                      ? chainMode
                        ? "탭으로 점을 찍어 잇기 · 숫자 입력 후 Enter로 정확한 길이 · Esc로 끊기"
                        : "누른 채 끌어서 직선 · 점·선·원점에 자석처럼 붙습니다"
                      : shapePending
                        ? tool === "rect"
                          ? "대각선 꼭짓점을 탭하세요 · 숫자 입력(Tab으로 가로/세로 전환) 후 Enter · Esc 취소"
                          : "크기를 정할 점을 탭하세요 · 지름 입력 후 Enter · Esc 취소"
                        : tool === "rect"
                          ? "첫 꼭짓점을 탭하거나, 누른 채 대각선으로 끌어서 그리세요"
                          : "중심을 탭하거나, 중심에서 누른 채 끌어서 그리세요"}
              </span>
              {tool === "line" && typedLength && (
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
                : "평면이나 선을 탭하면 선택됩니다."}
            </span>
          )}
          {pendingSaves > 0 && <span className="text-amber-700">저장 중…</span>}
        </div>

        <div className="relative flex-1 min-h-0">
          <div
            ref={mountRef}
            className="absolute inset-0"
            style={{ touchAction: "none", cursor: isEraseTool(tool) && mode === "sketch" ? "crosshair" : undefined }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerMove={handleCanvasMove}
            onPointerLeave={() => {
              if (!eraseGestureRef.current) clearErasePreviewLine();
            }}
            onContextMenu={handleCanvasContextMenu}
          />
          {treePanel}
        </div>
      </div>
    </div>
  );
}
