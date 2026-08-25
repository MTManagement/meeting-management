import Link from "next/link";
import { requireUser } from "@/lib/auth";
import AddMemberForm from "@/components/AddMemberForm";
import MembershipRequiredNotice from "@/components/MembershipRequiredNotice";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import { gradeLabel } from "@/lib/permissions";
import { getViewerMenuAccess } from "@/lib/menuPermissions";
import { prisma } from "@/lib/prisma";
import {
  addMemberColumn,
  deleteMemberColumn,
  saveMemberFields,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();
  const { membership: viewer, access } = await getViewerMenuAccess(
    clubId,
    user.id,
    "MEMBERS"
  );

  if (!viewer) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">회원 목록</h1>
        <MembershipRequiredNotice />
      </div>
    );
  }

  if (access === "NONE") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">회원 목록</h1>
        <AccessDeniedNotice />
      </div>
    );
  }

  const canWrite = access === "READ_WRITE";
  const [members, columns] = await Promise.all([
    prisma.member.findMany({
      where: { clubId },
      orderBy: { createdAt: "asc" },
      include: { fieldValues: true },
    }),
    prisma.memberColumn.findMany({
      where: { clubId },
      orderBy: { order: "asc" },
    }),
  ]);

  const valueMap = new Map<string, string>();
  for (const m of members) {
    for (const v of m.fieldValues) {
      valueMap.set(`${m.id}__${v.columnId}`, v.value);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">회원 목록</h1>
        <Link
          href={`/clubs/${clubId}/dues`}
          className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-900"
        >
          회비 납부현황 관리 →
        </Link>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        기본 항목(이름/직책/연락처) 외에, 관리자는 컬럼을 자유롭게
        추가해서 원하는 정보를 더 기록할 수 있습니다. 회원 강제 탈퇴는
        설정 화면에서 할 수 있습니다.
      </p>

      {canWrite && (
        <div className="mb-4 flex flex-wrap items-start gap-6">
          <AddMemberForm clubId={clubId} />

          <div>
            <div className="flex flex-wrap gap-2 mb-2">
              {columns.map((col) => (
                <form
                  key={col.id}
                  action={deleteMemberColumn}
                  className="flex items-center gap-1 rounded-full bg-gray-100 pl-2.5 pr-1 py-1 text-xs text-gray-600"
                >
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="columnId" value={col.id} />
                  {col.name}
                  <button
                    type="submit"
                    aria-label={`${col.name} 컬럼 삭제`}
                    className="rounded-full px-1.5 hover:bg-gray-200 hover:text-red-600"
                  >
                    ×
                  </button>
                </form>
              ))}
            </div>
            <form action={addMemberColumn} className="flex gap-2">
              <input type="hidden" name="clubId" value={clubId} />
              <input
                name="name"
                placeholder="새 컬럼 이름 (예: 생일)"
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-md bg-gray-900 text-white text-sm px-3 py-2 whitespace-nowrap"
              >
                + 컬럼 추가
              </button>
            </form>
          </div>
        </div>
      )}

      <form action={saveMemberFields}>
        <input type="hidden" name="clubId" value={clubId} />
        {columns.map((col) => (
          <input key={col.id} type="hidden" name="columnId" value={col.id} />
        ))}

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium">등급</th>
                <th className="px-4 py-3 font-medium">직책</th>
                <th className="px-4 py-3 font-medium">연락처</th>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className="px-4 py-3 font-medium whitespace-nowrap"
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={4 + columns.length}
                    className="px-4 py-6 text-center text-gray-400"
                  >
                    등록된 회원이 없습니다. 위 버튼으로 회원을 추가해보세요.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <input type="hidden" name="memberId" value={m.id} />
                    {m.name}
                  </td>
                  <td className="px-4 py-3 font-medium">{gradeLabel(m.grade)}</td>
                  <td className="px-4 py-3 text-gray-500">{m.role || "-"}</td>
                  <td className="px-4 py-3">{m.phone}</td>
                  {columns.map((col) => (
                    <td key={col.id} className="px-2 py-2">
                      {canWrite ? (
                        <input
                          name={`field__${m.id}__${col.id}`}
                          defaultValue={valueMap.get(`${m.id}__${col.id}`) ?? ""}
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                        />
                      ) : (
                        <span className="text-gray-600">
                          {valueMap.get(`${m.id}__${col.id}`) || "-"}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canWrite && members.length > 0 && columns.length > 0 && (
          <button
            type="submit"
            className="mt-4 rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            저장
          </button>
        )}
      </form>
    </div>
  );
}
