"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

type PlaneInput = { axis: "XY" | "YZ" | "XZ"; offset: number };
type PointInput = { id: string; x: number; y: number; z: number };
type EdgeInput = { fromId: string; toId: string };

// 클라이언트의 현재 스케치 상태(평면/점/선)를 통째로 저장한다.
// 그룹(가구)은 아직 다루지 않는다 — 다음 단계에서 추가.
export async function saveSketch(
  projectId: string,
  planes: PlaneInput[],
  points: PointInput[],
  edges: EdgeInput[]
) {
  const user = await requireUser();

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== user.id) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }

  const saved = await prisma.$transaction(async (tx) => {
    await tx.edge.deleteMany({ where: { projectId } });
    await tx.point.deleteMany({ where: { projectId } });
    await tx.plane.deleteMany({ where: { projectId } });

    if (planes.length > 0) {
      await tx.plane.createMany({
        data: planes.map((p) => ({ projectId, axis: p.axis, offset: p.offset })),
        skipDuplicates: true,
      });
    }

    const idMap = new Map<string, string>();
    for (const p of points) {
      const created = await tx.point.create({
        data: { projectId, x: p.x, y: p.y, z: p.z },
      });
      idMap.set(p.id, created.id);
    }

    for (const e of edges) {
      const fromId = idMap.get(e.fromId);
      const toId = idMap.get(e.toId);
      if (!fromId || !toId) continue;
      await tx.edge.create({ data: { projectId, fromId, toId } });
    }

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    const newPoints = await tx.point.findMany({ where: { projectId } });
    const newEdges = await tx.edge.findMany({ where: { projectId } });
    return { points: newPoints, edges: newEdges };
  });

  return saved;
}
