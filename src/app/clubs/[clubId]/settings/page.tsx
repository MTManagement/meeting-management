import { prisma } from "@/lib/prisma";
import { requireAdmin, isMainAdminGrade, gradeLabel } from "@/lib/permissions";
import {
  MENU_TYPES,
  MENU_TYPE_LABEL,
  ACCESS_LABEL,
  getMenuAccess,
  type Access,
} from "@/lib/menuPermissions";
import {
  approveMembershipRequest,
  rejectMembershipRequest,
  setMemberGrade,
  updateClubInfo,
  updateMemberRole,
  updateMenuPermissions,
  requestAdminTransfer,
  cancelAdminTransfer,
  respondAdminTransfer,
} from "./actions";

const CONFIGURABLE_GRADES = ["ADMIN", "MEMBER"] as const;
const ACCESS_OPTIONS: Access[] = ["READ_WRITE", "READ_ONLY", "NONE"];

export const dynamic = "force-dynamic";

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

  const [pendingTransfer, transferHistory] = await Promise.all([
    prisma.adminTransferRequest.findFirst({
      where: { clubId, status: "PENDING" },
      include: { fromMember: true, toMember: true },
    }),
    prisma.adminTransferRequest.findMany({
      where: { clubId, status: { in: ["ACCEPTED", "REJECTED", "CANCELED"] } },
      include: { fromMember: true, toMember: true },
      orderBy: { respondedAt: "desc" },
      take: 10,
    }),
  ]);
  const adminCandidates = members.filter((m) => m.grade === "ADMIN");

  const accessMatrix: Record<string, Record<string, Access>> = {};
  for (const grade of CONFIGURABLE_GRADES) {
    accessMatrix[grade] = {};
    for (const menuType of MENU_TYPES) {
      accessMatrix[grade][menuType] = await getMenuAccess(
        clubId,
        grade,
        menuType
      );
    }
  }

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
            <div key={m.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {gradeLabel(m.grade)}
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
                      {m.grade === "ADMIN"
                        ? "일반 회원으로 되돌리기"
                        : "관리자권한자로 승격"}
                    </button>
                  </form>
                )}
              </div>

              <form action={updateMemberRole} className="flex items-center gap-2">
                <input type="hidden" name="clubId" value={clubId} />
                <input type="hidden" name="memberId" value={m.id} />
                <input
                  name="role"
                  defaultValue={m.role}
                  placeholder="모임 내 표시 직책 (예: 회장, 총무 - 선택 입력)"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 text-xs px-3 py-1.5 whitespace-nowrap"
                >
                  저장
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      {/* 메인 관리자 위임 */}
      <section>
        <h2 className="font-semibold mb-3">메인 관리자 위임</h2>
        <p className="text-xs text-gray-400 mb-3">
          메인 관리자는 관리자권한자 중 한 명에게 위임을 요청할 수 있고,
          상대방이 수락해야 위임이 완료됩니다. 위임이 완료되어야만 기존
          메인 관리자가 모임을 탈퇴할 수 있습니다.
        </p>

        {pendingTransfer && pendingTransfer.toMemberId === viewer.id && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
            <p className="text-sm mb-3">
              <span className="font-medium">{pendingTransfer.fromMember.name}</span>
              님이 메인 관리자 권한을 위임하려고 합니다. 수락하시겠습니까?
            </p>
            <div className="flex gap-2">
              <form action={respondAdminTransfer}>
                <input type="hidden" name="clubId" value={clubId} />
                <input type="hidden" name="requestId" value={pendingTransfer.id} />
                <input type="hidden" name="decision" value="accept" />
                <button
                  type="submit"
                  className="rounded-md bg-gray-900 text-white text-xs px-3 py-1.5"
                >
                  수락
                </button>
              </form>
              <form action={respondAdminTransfer}>
                <input type="hidden" name="clubId" value={clubId} />
                <input type="hidden" name="requestId" value={pendingTransfer.id} />
                <input type="hidden" name="decision" value="reject" />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 text-gray-600 text-xs px-3 py-1.5"
                >
                  거절
                </button>
              </form>
            </div>
          </div>
        )}

        {pendingTransfer && pendingTransfer.toMemberId !== viewer.id && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{pendingTransfer.fromMember.name}</span>
              님이{" "}
              <span className="font-medium">{pendingTransfer.toMember.name}</span>
              님에게 위임을 요청했습니다 (수락 대기중)
            </p>
            {isMainAdmin && pendingTransfer.fromMemberId === viewer.id && (
              <form action={cancelAdminTransfer} className="shrink-0">
                <input type="hidden" name="clubId" value={clubId} />
                <input type="hidden" name="requestId" value={pendingTransfer.id} />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 text-xs px-3 py-1.5 whitespace-nowrap"
                >
                  요청 취소
                </button>
              </form>
            )}
          </div>
        )}

        {!pendingTransfer && isMainAdmin && (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-4">
            {adminCandidates.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">
                위임하려면 먼저 관리자권한자를 지정해주세요.
              </div>
            )}
            {adminCandidates.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-4 py-3 gap-3"
              >
                <p className="text-sm font-medium">{m.name}</p>
                <form action={requestAdminTransfer} className="shrink-0">
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="toMemberId" value={m.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 text-xs px-3 py-1.5 whitespace-nowrap"
                  >
                    위임 요청 보내기
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {transferHistory.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-2">위임 이력</h3>
            <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
              {transferHistory.map((h) => (
                <div key={h.id} className="px-4 py-2.5 text-xs text-gray-500">
                  {h.fromMember.name} → {h.toMember.name}
                  {" · "}
                  {h.status === "ACCEPTED"
                    ? "위임 완료"
                    : h.status === "REJECTED"
                      ? "거절됨"
                      : "취소됨"}
                  {h.respondedAt &&
                    ` · ${new Intl.DateTimeFormat("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }).format(h.respondedAt)}`}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 메뉴별 접근 권한 */}
      <section>
        <h2 className="font-semibold mb-3">메뉴별 접근 권한</h2>
        <p className="text-xs text-gray-400 mb-3">
          등급별로 메뉴마다 읽기/쓰기, 읽기만, 접근불가를 설정할 수 있습니다.
          메인 관리자는 항상 모든 메뉴에 읽기/쓰기 권한을 갖습니다.
        </p>
        <form
          action={updateMenuPermissions}
          className="rounded-lg border border-gray-200 bg-white p-4"
        >
          <input type="hidden" name="clubId" value={clubId} />
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-2 pr-4 font-medium">등급</th>
                  {MENU_TYPES.map((menuType) => (
                    <th key={menuType} className="py-2 px-2 font-medium whitespace-nowrap">
                      {MENU_TYPE_LABEL[menuType]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CONFIGURABLE_GRADES.map((grade) => (
                  <tr key={grade} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">
                      {gradeLabel(grade)}
                    </td>
                    {MENU_TYPES.map((menuType) => (
                      <td key={menuType} className="py-2 px-2">
                        <select
                          name={`access__${grade}__${menuType}`}
                          defaultValue={accessMatrix[grade][menuType]}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                          {ACCESS_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {ACCESS_LABEL[option]}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="submit"
            className="mt-4 rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            저장
          </button>
        </form>
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
