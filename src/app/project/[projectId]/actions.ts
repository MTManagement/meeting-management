"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { randomUUID } from "crypto";

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

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// 원점(mm)·법선·가로축으로 평면을 만든다. 오프셋 평면, 점을 지나는 평행
// 평면, 선에 수직인 평면 모두 방향 계산은 화면(미리보기)과 똑같이
// 클라이언트에서 하고, 여기서는 저장만 한다. label이 없으면 "평면 N".
export async function createPlaneFromDefinition(
  projectId: string,
  def: { label?: string; origin: Vec3; normal: Vec3; uAxis: Vec3 }
) {
  await assertOwner(projectId);
  const normal = normalize(def.normal);
  const uAxis = normalize(def.uAxis);
  let label = def.label?.trim();
  if (!label) {
    const count = await prisma.plane.count({ where: { projectId } });
    label = `평면 ${count + 1}`;
  }
  return prisma.plane.create({
    data: {
      projectId,
      label,
      originX: def.origin.x,
      originY: def.origin.y,
      originZ: def.origin.z,
      normalX: normal.x,
      normalY: normal.y,
      normalZ: normal.z,
      uAxisX: uAxis.x,
      uAxisY: uAxis.y,
      uAxisZ: uAxis.z,
    },
  });
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
type EdgeInput = { fromId: string; toId: string; strokeId?: string | null };

// 스케치 하나의 점/선을 통째로 교체 저장한다. 점을 하나씩 순서대로
// 넣으면 자유곡선처럼 점이 수백 개일 때 트랜잭션 제한시간을 넘겨 저장이
// 실패했기 때문에, id를 미리 만들어 createMany로 한 번에 넣는다.
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

  const idMap = new Map<string, string>();
  for (const p of points) idMap.set(p.id, randomUUID());

  const edgeRows = [];
  for (const e of edges) {
    const fromId = idMap.get(e.fromId);
    const toId = idMap.get(e.toId);
    if (!fromId || !toId) continue;
    edgeRows.push({ projectId, sketchId, fromId, toId, strokeId: e.strokeId ?? null });
  }

  await prisma.$transaction([
    prisma.edge.deleteMany({ where: { sketchId } }),
    prisma.point.deleteMany({ where: { sketchId } }),
    prisma.point.createMany({
      data: points.map((p) => ({
        id: idMap.get(p.id)!,
        projectId,
        sketchId,
        x: p.x,
        y: p.y,
        z: p.z,
        isVertex: p.isVertex ?? true,
      })),
    }),
    prisma.edge.createMany({ data: edgeRows }),
    prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }),
  ]);

  return { ok: true };
}

// 오버뷰에서 여러 스케치의 점을 잇는 3D 연결선을 담는, 평면 없는 스케치.
// 프로젝트당 하나만 쓰고 없으면 만든다.
export async function ensureFreeSketch(projectId: string) {
  await assertOwner(projectId);
  const existing = await prisma.sketch.findFirst({ where: { projectId, planeId: null } });
  if (existing) return { id: existing.id, name: existing.name };
  const created = await prisma.sketch.create({
    data: { projectId, planeId: null, name: "3D 연결선" },
  });
  return { id: created.id, name: created.name };
}
