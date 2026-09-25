import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import SketchCanvas from "./SketchCanvas";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== user.id) notFound();

  const [planes, points, edges] = await Promise.all([
    prisma.plane.findMany({ where: { projectId } }),
    prisma.point.findMany({ where: { projectId } }),
    prisma.edge.findMany({ where: { projectId } }),
  ]);

  return (
    <SketchCanvas
      projectId={projectId}
      initialPlanes={planes.map((p) => ({ axis: p.axis as "XY" | "YZ" | "XZ", offset: p.offset }))}
      initialPoints={points.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }))}
      initialEdges={edges.map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId }))}
    />
  );
}
