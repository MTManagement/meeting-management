import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logout } from "@/app/login/actions";
import { gradeLabel } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    include: { club: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="min-h-screen bg-slate-200">
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

        <form action="/clubs" className="flex gap-2 mb-4">
          <input
            name="q"
            placeholder="모임 이름으로 검색"
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-white border border-gray-300 text-sm px-4 py-2.5"
          >
            검색
          </button>
          <Link
            href="/clubs"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2.5 whitespace-nowrap"
          >
            + 모임 생성
          </Link>
        </form>

        <div className="flex items-center justify-between mb-3 mt-8">
          <h1 className="text-lg font-bold">내 모임</h1>
          <span className="text-sm text-gray-400">{memberships.length}개</span>
        </div>

        {memberships.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 px-4 py-12 text-center">
            <p className="text-gray-400 text-sm mb-4">
              아직 가입한 모임이 없습니다.
            </p>
            <Link
              href="/clubs"
              className="inline-block rounded-md bg-gray-900 text-white text-sm px-4 py-2"
            >
              모임 찾기 / 만들기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {memberships.map((m) => (
              <Link
                key={m.id}
                href={`/clubs/${m.club.id}`}
                className="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-md hover:border-gray-300 transition-shadow"
              >
                <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold text-sm mb-3">
                  {m.club.name.slice(0, 1)}
                </div>
                <p className="font-medium text-sm truncate">{m.club.name}</p>
                <p className="text-xs text-gray-600 font-medium mt-0.5">
                  {gradeLabel(m.grade)}
                  {m.role ? ` · ${m.role}` : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
