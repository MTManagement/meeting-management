import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth";
import { saveAttendance } from "../actions";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const STATUS_OPTIONS = ["참석", "불참", "미정"] as const;

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ clubId: string; id: string }>;
}) {
  const { clubId, id } = await params;
  await requireMembership(clubId);

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.clubId !== clubId) notFound();

  const [members, attendances] = await Promise.all([
    prisma.member.findMany({ where: { clubId }, orderBy: { createdAt: "asc" } }),
    prisma.attendance.findMany({ where: { eventId: id } }),
  ]);

  const statusMap = new Map(attendances.map((a) => [a.memberId, a.status]));

  const infoRows: { label: string; value: string }[] = [];
  if (event.location) infoRows.push({ label: "장소", value: event.location });
  if (event.address) infoRows.push({ label: "주소", value: event.address });
  if (event.fee) infoRows.push({ label: "참석비", value: event.fee });
  if (event.maxAttendees)
    infoRows.push({ label: "최대 인원", value: `${event.maxAttendees}명` });
  if (event.description)
    infoRows.push({ label: "설명", value: event.description });

  return (
    <div>
      <Link
        href={`/clubs/${clubId}/schedule`}
        className="text-sm text-gray-500 hover:text-gray-900 mb-3 inline-block"
      >
        ← 일정 목록
      </Link>

      <h1 className="text-2xl font-bold mb-1">{event.title}</h1>
      <p className="text-gray-600 text-sm mb-4">{formatDate(event.date)}</p>

      {infoRows.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4 space-y-1">
          {infoRows.map((row) => (
            <p key={row.label} className="text-sm text-gray-600">
              <span className="text-gray-400">{row.label}: </span>
              {row.value}
            </p>
          ))}
        </div>
      )}

      <h2 className="font-semibold mb-2">참석 여부</h2>
      <form action={saveAttendance}>
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="clubId" value={clubId} />

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium text-center" colSpan={3}>
                  참석 여부
                </th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                    등록된 회원이 없습니다.
                  </td>
                </tr>
              )}
              {members.map((m) => {
                const current = statusMap.get(m.id) ?? "미정";
                return (
                  <tr key={m.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <input type="hidden" name="memberId" value={m.id} />
                      {m.name}
                    </td>
                    {STATUS_OPTIONS.map((status) => (
                      <td key={status} className="px-2 py-2 text-center">
                        <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <input
                            type="radio"
                            name={`status__${m.id}`}
                            value={status}
                            defaultChecked={current === status}
                            className="h-3.5 w-3.5 accent-gray-900"
                          />
                          {status}
                        </label>
                      </td>
                    ))}
                  </tr>
                );
              })}
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
