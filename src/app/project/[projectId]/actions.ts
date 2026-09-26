"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

type Vec3 = { x: number; y: number; z: number };

async function assertOwner(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== user.id) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }
  return project;
}

// 평면 이름은 CAD 관례대로 "그 평면 안에 놓인 두 축"을 가리킨다
// (법선은 이름에 없는 나머지 한 축). Z축이 상하(수직)이므로:
// - XY: X,Y가 평면에 놓임 → 법선 Z → 바닥면
// - XZ: X,Z가 평면에 놓임 → 법선 Y → 벽면
// - YZ: Y,Z가 평면에 놓임 → 법선 X → 벽면
const BASE_PLANES = [
  { label: "XY", normal: { x: 0, y: 0, z: 1 }, uAxis: { x: 1, y: 0, z: 0 } },
  { label: "YZ", normal: { x: 1, y: 0, z: 0 }, uAxis: { x: 0, y: 1, z: 0 } },
  { label: "XZ", normal: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 } },
] as const;

// 프로젝트를 처음 열 때 XY/YZ/XZ 기준 평면이 없으면 만들어둔다.
// 예전에 XY/XZ 축 이름을 서로 바꾸기 전에 이미 만들어진 프로젝트는
// 라벨은 "XY"인데 법선은 옛날(XZ) 값 그대로인 채로 DB에 남아있을 수
// 있어서, 라벨이 같아도 법선/uAxis가 최신 정의와 다르면 고쳐준다.
// (Point는 절대 mm 좌표를 저장하므로 이미 그려둔 선은 영향받지 않는다.)
export async function ensureBasePlanes(projectId: string) {
  await assertOwner(projectId);
  const existing = await prisma.plane.findMany({ where: { projectId } });

  const toCreate = BASE_PLANES.filter((b) => !existing.some((e) => e.label === b.label));
  if (toCreate.length > 0) {
    await prisma.plane.createMany({
      data: toCreate.map((b) => ({
        projectId,
        label: b.label,
        originX: 0,
        originY: 0,
        originZ: 0,
        normalX: b.normal.x,
        normalY: b.normal.y,
        normalZ: b.normal.z,
        uAxisX: b.uAxis.x,
        uAxisY: b.uAxis.y,
        uAxisZ: b.uAxis.z,
      })),
    });
  }

  for (const b of BASE_PLANES) {
    const found = existing.find((e) => e.label === b.label);
    if (!found) continue;
    const mismatched =
      found.normalX !== b.normal.x ||
      found.normalY !== b.normal.y ||
      found.normalZ !== b.normal.z ||
      found.uAxisX !== b.uAxis.x ||
      found.uAxisY !== b.uAxis.y ||
      found.uAxisZ !== b.uAxis.z;
    if (!mismatched) continue;
    await prisma.plane.update({
      where: { id: found.id },
      data: {
        normalX: b.normal.x,
        normalY: b.normal.y,
        normalZ: b.normal.z,
        uAxisX: b.uAxis.x,
        uAxisY: b.uAxis.y,
        uAxisZ: b.uAxis.z,
      },
    });
  }
}

// XY/YZ/XZ 기준 평면에서 법선 방향으로 offsetMm 만큼 이동한 평행 평면을 만든다.
export async function createOffsetPlane(
  projectId: string,
  baseLabel: "XY" | "YZ" | "XZ",
  offsetMm: number
) {
  await assertOwner(projectId);
  const base = BASE_PLANES.find((b) => b.label === baseLabel)!;
  const plane = await prisma.plane.create({
    data: {
      projectId,
      label: `${baseLabel}+${offsetMm}mm`,
      originX: base.normal.x * offsetMm,
      originY: base.normal.y * offsetMm,
      originZ: base.normal.z * offsetMm,
      normalX: base.normal.x,
      normalY: base.normal.y,
      normalZ: base.normal.z,
      uAxisX: base.uAxis.x,
      uAxisY: base.uAxis.y,
      uAxisZ: base.uAxis.z,
    },
  });
  return plane;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// 선택한 선(점 두 개)의 끝점을 지나면서 그 선의 방향에 수직인 평면을 만든다.
export async function createPerpendicularPlane(
  projectId: string,
  origin: Vec3,
  lineDirection: Vec3
) {
  await assertOwner(projectId);
  const normal = normalize(lineDirection);
  // normal과 평행하지 않은 임의의 기준 벡터를 골라 평면 내 가로축(uAxis)을 만든다.
  const ref: Vec3 = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const uAxis = normalize(cross(ref, normal));

  const count = await prisma.plane.count({ where: { projectId } });
  const plane = await prisma.plane.create({
    data: {
      projectId,
      label: `평면 ${count + 1}`,
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      normalX: normal.x,
      normalY: normal.y,
      normalZ: normal.z,
      uAxisX: uAxis.x,
      uAxisY: uAxis.y,
      uAxisZ: uAxis.z,
    },
  });
  return plane;
}

export async function createSketch(projectId: string, planeId: string) {
  await assertOwner(projectId);
  const count = await prisma.sketch.count({ where: { planeId } });
  const sketch = await prisma.sketch.create({
    data: { projectId, planeId, name: `Line ${count + 1}` },
  });
  return sketch;
}

export async function deleteSketch(projectId: string, sketchId: string) {
  await assertOwner(projectId);
  const sketch = await prisma.sketch.findUnique({ where: { id: sketchId } });
  if (!sketch || sketch.projectId !== projectId) {
    throw new Error("스케치를 찾을 수 없습니다.");
  }
  // Point/Edge는 onDelete: Cascade로 함께 삭제된다.
  await prisma.sketch.delete({ where: { id: sketchId } });
}

type PointInput = { id: string; x: number; y: number; z: number; isVertex?: boolean };
type EdgeInput = { fromId: string; toId: string };

// 스케치 하나(평면 하나에 종속된 점/선 묶음)의 내용을 통째로 저장한다.
export async function saveSketchGeometry(
  projectId: string,
  sketchId: string,
  points: PointInput[],
  edges: EdgeInput[]
) {
  await assertOwner(projectId);
  const sketch = await prisma.sketch.findUnique({ where: { id: sketchId } });
  if (!sketch || sketch.projectId !== projectId) {
    throw new Error("스케치를 찾을 수 없습니다.");
  }

  const saved = await prisma.$transaction(async (tx) => {
    await tx.edge.deleteMany({ where: { sketchId } });
    await tx.point.deleteMany({ where: { sketchId } });

    const idMap = new Map<string, string>();
    for (const p of points) {
      const created = await tx.point.create({
        data: { projectId, sketchId, x: p.x, y: p.y, z: p.z, isVertex: p.isVertex ?? true },
      });
      idMap.set(p.id, created.id);
    }

    for (const e of edges) {
      const fromId = idMap.get(e.fromId);
      const toId = idMap.get(e.toId);
      if (!fromId || !toId) continue;
      await tx.edge.create({ data: { projectId, sketchId, fromId, toId } });
    }

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    const newPoints = await tx.point.findMany({ where: { sketchId } });
    const newEdges = await tx.edge.findMany({ where: { sketchId } });
    return { points: newPoints, edges: newEdges };
  });

  return saved;
}
