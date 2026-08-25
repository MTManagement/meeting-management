import { prisma } from "@/lib/prisma";
import { requireAdmin, isMainAdminGrade } from "@/lib/permissions";
import {
  approveMembershipRequest,
  rejectMembershipRequest,
  setMemberGrade,
  updateClubInfo,
} from "./actions";

export const dynamic = "force-dynamic";

const GRADE_LABEL: Record<string, string> = {
  MAIN_ADMIN: "메인 관리자",
  ADMIN: "관리자권한자",
  MEMBER: "일반 회원",
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { clubId } = await params;
  const { error, saved } = await searchParams;
  const { membership: viewer } = await requireAdmin(clubId);
  const isMainAdmin = isMainAdminGrade(viewer.grade);

  const [club, pendingRequests, members] = await Promise.all([
    prisma.club.findUniqueOrThrow({ where: { id: clubId } }),
    prisma.membershipRequest.findMany({
      where: { clubId, status: "PENDING" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: { clubId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="text-gray-600 text-sm mt-1">관리자 전용 화면입니다.</p>
      </div>

      {/* 가입 신청 목록 */}
      <section>
        <h2 className="font-semibold mb-3">가입 신청 목록</h2>
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {pendingRequests.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              대기중인 가입 신청이 없습니다.
            </div>
          )}
          {pendingRequests.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between px-4 py-3 gap-3"
            >
              <p className="text-sm font-medium">{req.user.name}</p>
              <div className="flex items-center gap-2 shrink-0">
                <form action={approveMembershipRequest}>
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="requestId" value={req.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-gray-900 text-white text-xs px-3 py-1.5"
                  >
                    승인
                  </button>
                </form>
                <form action={rejectMembershipRequest}>
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="requestId" value={req.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 text-gray-600 text-xs px-3 py-1.5"
                  >
                    거절
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 회원 목록 + 권한 위임/회수 */}
      <section>
        <h2 className="font-semibold mb-3">회원 · 권한 관리</h2>
        <p className="text-xs text-gray-400 mb-3">
          {isMainAdmin
            ? "관리자권한자는 메인 관리자와 동일한 권한을 갖되, 모임 삭제와 권한 위임은 할 수 없습니다."
            : "권한 위임/회수는 메인 관리자만 할 수 있습니다."}
        </p>
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-3 gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.name}
                  <span className="ml-2 text-xs text-gray-400">
                    {m.role}
                  </span>
                </p>
                <p className="text-xs text-gray-400">
                  {GRADE_LABEL[m.grade] ?? m.grade}
                </p>
              </div>
              {isMainAdmin && m.grade !== "MAIN_ADMIN" && (
                <form action={setMemberGrade} className="shrink-0">
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <input
                    type="hidden"
                    name="grade"
                    value={m.grade === "ADMIN" ? "MEMBER" : "ADMIN"}
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 text-xs px-3 py-1.5 whitespace-nowrap"
                  >
                    {m.grade === "ADMIN" ? "권한 회수" : "관리자 위임"}
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 모임 기본 정보 수정 */}
      <section>
        <h2 className="font-semibold mb-3">모임 기본 정보</h2>
        {error === "duplicate" && (
          <div className="rounded-md bg-red-50 text-red-600 text-sm px-3 py-2 mb-3">
            이미 사용 중인 모임 이름입니다.
          </div>
        )}
        {saved === "1" && (
          <div className="rounded-md bg-green-50 text-green-700 text-sm px-3 py-2 mb-3">
            저장되었습니다.
          </div>
        )}
        <form
          action={updateClubInfo}
          className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
        >
          <input type="hidden" name="clubId" value={clubId} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              모임명
            </label>
            <input
              name="name"
              defaultValue={club.name}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              모임 소개
            </label>
            <textarea
              name="description"
              defaultValue={club.description ?? ""}
              rows={3}
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
    </div>
  );
}
