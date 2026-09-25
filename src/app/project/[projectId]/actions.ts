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

const BASE_PLANES = [
  { label: "XY", normal: { x: 0, y: 0, z: 1 }, uAxis: { x: 1, y: 0, z: 0 } },
  { label: "YZ", normal: { x: 1, y: 0, z: 0 }, uAxis: { x: 0, y: 1, z: 0 } },
  { label: "XZ", normal: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 } },
] as const;

// 프로젝트를 처음 열 때 XY/YZ/XZ 기준 평면이 없으면 만들어둔다.
export async function ensureBasePlanes(projectId: string) {
  await assertOwner(projectId);
  const existing = await prisma.plane.findMany({ where: { projectId } });
  const missing = BASE_PLANES.filter((b) => !existing.some((e) => e.label === b.label));
  if (missing.length === 0) return;
  await prisma.plane.createMany({
    data: missing.map((b) => ({
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
    data: { projectId, planeId, name: `스케치 ${count + 1}` },
  });
  return sketch;
}

type PointInput = { id: string; x: number; y: number; z: number };
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
        data: { projectId, sketchId, x: p.x, y: p.y, z: p.z },
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
