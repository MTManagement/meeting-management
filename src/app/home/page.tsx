import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logout } from "@/app/login/actions";
import { createProject } from "./actions";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(date);
}

export default async function HomePage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-[#faf6ee]">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sm text-gray-500">안녕하세요,</p>
            <p className="text-lg font-bold text-gray-900">{user.name}님</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              로그아웃
            </button>
          </form>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">내 프로젝트</h1>
          <span className="text-sm text-gray-400">{projects.length}개</span>
        </div>

        <form action={createProject} className="flex gap-2 mb-6">
          <input
            name="name"
            placeholder="새 프로젝트 이름 (예: 거실 리모델링)"
            required
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2.5 whitespace-nowrap"
          >
            + 만들기
          </button>
        </form>

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              아직 프로젝트가 없습니다. 위에서 새 프로젝트를 만들어보세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-md hover:border-gray-300 transition-shadow"
              >
                <p className="font-medium text-sm truncate">{p.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(p.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
