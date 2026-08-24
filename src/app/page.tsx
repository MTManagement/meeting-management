import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logout } from "@/app/login/actions";

export const dynamic = "force-dynamic";

export default async function MainPage() {
  const user = await requireUser();

  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    include: { club: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="min-h-screen bg-slate-200">
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="flex items-center justify-between mb-6">
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

        <h1 className="text-xl font-bold mb-3">내 모임</h1>

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-4">
          {memberships.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              아직 가입한 모임이 없습니다.
            </div>
          )}
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/clubs/${m.club.id}`}
              className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
            >
              <div>
                <p className="font-medium text-sm">{m.club.name}</p>
                <p className="text-xs text-gray-400">{m.role}</p>
              </div>
              <span className="text-gray-300">→</span>
            </Link>
          ))}
        </div>

        <Link
          href="/clubs"
          className="block text-center rounded-md bg-gray-900 text-white text-sm px-4 py-3"
        >
          모임 찾기 / 만들기
        </Link>
      </div>
    </div>
  );
}
