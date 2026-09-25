import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 스케치 캔버스는 다음 단계에서 이어서 만든다 (스케치플레인 프로토타입을 이식).
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== user.id) notFound();

  return (
    <div className="min-h-screen bg-[#faf6ee] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{project.name}</h1>
        <p className="text-gray-500 text-sm">
          스케치 캔버스는 다음 단계에서 이어서 만듭니다.
        </p>
      </div>
    </div>
  );
}
