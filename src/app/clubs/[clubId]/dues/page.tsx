import { prisma } from "@/lib/prisma";
import DuesControls from "@/components/DuesControls";
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
        총무·회장 전용 관리 화면입니다. (역할별 접근 제한은 아직 미적용 — 이
        모임에 가입한 회원이면 누구나 볼 수 있습니다)
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
                        className="h-4 w-4 accent-gray-900"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {members.length > 0 && (
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
