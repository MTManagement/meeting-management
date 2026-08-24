import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { createClub, joinClub } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClubsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const [clubs, myMemberships] = await Promise.all([
    prisma.club.findMany({
      where: query ? { name: { contains: query, mode: "insensitive" } } : {},
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true } } },
    }),
    prisma.member.findMany({ where: { userId: user.id } }),
  ]);

  const myClubIds = new Set(myMemberships.map((m) => m.clubId));

  return (
    <div className="min-h-screen bg-slate-200">
      <div className="mx-auto max-w-xl px-4 py-10">
        <Link href="/" className="text-sm text-gray-500 hover:underline">
          ← 내 모임
        </Link>
        <h1 className="text-xl font-bold mt-2 mb-4">모임 찾기</h1>

        <form className="flex gap-2 mb-6">
          <input
            name="q"
            defaultValue={query}
            placeholder="모임 이름으로 검색"
            className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            검색
          </button>
        </form>

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-6">
          {clubs.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              {query ? "검색 결과가 없습니다." : "생성된 모임이 없습니다."}
            </div>
          )}
          {clubs.map((club) => {
            const joined = myClubIds.has(club.id);
            return (
              <div
                key={club.id}
                className="flex items-center justify-between px-4 py-3 gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{club.name}</p>
                  <p className="text-xs text-gray-400">
                    회원 {club._count.members}명
                  </p>
                </div>
                {joined ? (
                  <Link
                    href={`/clubs/${club.id}`}
                    className="text-sm text-gray-500 underline underline-offset-2 shrink-0"
                  >
                    이동
                  </Link>
                ) : (
                  <form action={joinClub}>
                    <input type="hidden" name="clubId" value={club.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-gray-900 text-white text-xs px-3 py-1.5 shrink-0"
                    >
                      가입하기
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-sm mb-3">새 모임 만들기</h2>
          <form action={createClub} className="space-y-2">
            <input
              name="name"
              placeholder="모임 이름"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              name="description"
              placeholder="모임 소개 (선택)"
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
            >
              만들기
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
