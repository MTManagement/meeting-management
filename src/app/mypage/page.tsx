import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeLabel } from "@/lib/permissions";
import { leaveClub } from "@/app/clubs/[clubId]/actions";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  const { saved } = await searchParams;

  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    include: { club: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="min-h-screen bg-slate-200">
      <div className="mx-auto max-w-xl px-4 py-10">
        <Link href="/home" className="text-sm text-gray-500 hover:underline">
          ← 내 모임
        </Link>
        <h1 className="text-xl font-bold mt-2 mb-6">마이페이지</h1>

        <section className="mb-8">
          <h2 className="font-semibold text-sm mb-3">개인정보</h2>
          {saved === "1" && (
            <div className="rounded-md bg-green-50 text-green-700 text-sm px-3 py-2 mb-3">
              저장되었습니다.
            </div>
          )}
          <form
            action={updateProfile}
            className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
          >
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                닉네임
              </label>
              <input
                name="name"
                defaultValue={user.name}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
            >
              저장
            </button>
          </form>
        </section>

        <section>
          <h2 className="font-semibold text-sm mb-3">
            가입한 모임 ({memberships.length}개)
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {memberships.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">
                아직 가입한 모임이 없습니다.
              </div>
            )}
            {memberships.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-4 py-3 gap-3"
              >
                <Link
                  href={`/clubs/${m.club.id}`}
                  className="min-w-0 flex-1 hover:text-gray-900"
                >
                  <p className="font-medium text-sm truncate">
                    {m.club.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {gradeLabel(m.grade)}
                  </p>
                </Link>
                {m.grade === "MAIN_ADMIN" ? (
                  <span className="text-xs text-gray-300 shrink-0">
                    메인 관리자는 위임 후 탈퇴 가능
                  </span>
                ) : (
                  <form action={leaveClub} className="shrink-0">
                    <input type="hidden" name="clubId" value={m.club.id} />
                    <button
                      type="submit"
                      className="text-xs text-gray-400 hover:text-red-600 whitespace-nowrap"
                    >
                      탈퇴
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
