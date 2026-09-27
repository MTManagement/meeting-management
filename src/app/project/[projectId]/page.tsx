import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ensureBasePlanes } from "./actions";
import ProjectCanvas from "./ProjectCanvas";

export const dynamic = "force-dynamic";

type DbSketch = {
  id: string;
  name: string;
  points: { id: string; x: number; y: number; z: number; isVertex: boolean }[];
  edges: { id: string; fromId: string; toId: string; strokeId: string | null }[];
};

function toSketchData(s: DbSketch) {
  return {
    id: s.id,
    name: s.name,
    points: s.points.map((pt) => ({
      id: pt.id,
      x: pt.x,
      y: pt.y,
      z: pt.z,
      isVertex: pt.isVertex,
    })),
    edges: s.edges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      strokeId: e.strokeId ?? undefined,
    })),
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== user.id) notFound();

  await ensureBasePlanes(projectId);

  const planes = await prisma.plane.findMany({
    where: { projectId },
    include: {
      sketches: {
        include: { points: true, edges: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const freeSketch = await prisma.sketch.findFirst({
    where: { projectId, planeId: null },
    include: { points: true, edges: true },
  });

  return (
    <ProjectCanvas
      projectId={projectId}
      projectName={project.name}
      planes={planes.map((p) => ({
        id: p.id,
        label: p.label,
        origin: { x: p.originX, y: p.originY, z: p.originZ },
        normal: { x: p.normalX, y: p.normalY, z: p.normalZ },
        uAxis: { x: p.uAxisX, y: p.uAxisY, z: p.uAxisZ },
        sketches: p.sketches.map(toSketchData),
      }))}
      freeSketch={freeSketch ? toSketchData(freeSketch) : null}
    />
  );
}
