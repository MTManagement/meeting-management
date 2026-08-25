import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import DuesControls from "@/components/DuesControls";
import MembershipRequiredNotice from "@/components/MembershipRequiredNotice";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import { getViewerMenuAccess } from "@/lib/menuPermissions";
import { saveDues } from "./actions";
import {
  isPeriodType,
  getPeriodIndexes,
  getPeriodLabel,
  cellKey,
  type PeriodType,
} from "@/lib/duesPeriods";

export const dynamic = "force-dynamic";

export default async function DuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ year?: string; unit?: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();
  const { membership: viewer, access } = await getViewerMenuAccess(
    clubId,
    user.id,
    "DUES"
  );
  if (!viewer) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">회비 납부현황</h1>
        <MembershipRequiredNotice />
      </div>
    );
  }
  if (access === "NONE") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">회비 납부현황</h1>
        <AccessDeniedNotice />
      </div>
    );
  }
  const canWrite = access === "READ_WRITE";
  const sp = await searchParams;
  const year = Number(sp.year) || new Date().getFullYear();
  const periodType: PeriodType = isPeriodType(sp.unit ?? "")
    ? (sp.unit as PeriodType)
    : "MONTH";

  const [members, payments] = await Promise.all([
    prisma.member.findMany({ where: { clubId }, orderBy: { createdAt: "asc" } }),
    prisma.duesPayment.findMany({
      where: { year, periodType, member: { clubId } },
    }),
  ]);

  const paidMap = new Map<string, boolean>();
  for (const p of payments) {
    paidMap.set(cellKey(p.memberId, p.periodIndex), p.paid);
  }

  const indexes = getPeriodIndexes(periodType);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">회비 납부현황</h1>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        {canWrite
          ? "회비 납부현황을 체크하고 저장할 수 있습니다."
          : "조회 전용입니다. 저장 권한은 관리자가 설정에서 부여할 수 있습니다."}
      </p>

      <DuesControls clubId={clubId} year={year} periodType={periodType} />

      <form action={saveDues}>
        <input type="hidden" name="clubId" value={clubId} />
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="periodType" value={periodType} />

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="sticky left-0 bg-gray-50 px-4 py-3 font-medium whitespace-nowrap">
                  이름
                </th>
                {indexes.map((idx) => (
                  <th
                    key={idx}
                    className="px-3 py-3 font-medium text-center whitespace-nowrap"
                  >
                    {getPeriodLabel(periodType, idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={indexes.length + 1}
                    className="px-4 py-6 text-center text-gray-400"
                  >
                    등록된 회원이 없습니다. 회원 목록에서 먼저 회원을
                    추가해주세요.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 last:border-0">
                  <td className="sticky left-0 bg-white px-4 py-2 font-medium whitespace-nowrap">
                    <input type="hidden" name="memberId" value={m.id} />
                    {m.name}
                  </td>
                  {indexes.map((idx) => (
                    <td key={idx} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        name={`paid__${m.id}__${idx}`}
                        defaultChecked={paidMap.get(cellKey(m.id, idx)) ?? false}
                        disabled={!canWrite}
                        className="h-4 w-4 accent-gray-900"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {members.length > 0 && canWrite && (
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
