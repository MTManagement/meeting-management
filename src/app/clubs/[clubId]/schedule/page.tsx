import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import CreateEventForm from "@/components/CreateEventForm";
import MembershipRequiredNotice from "@/components/MembershipRequiredNotice";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import { getViewerMenuAccess } from "@/lib/menuPermissions";
import { deleteEvent } from "./actions";

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

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// 일정 목록을 월간 캘린더 격자로 배치. 완벽한 양방향 동기화가 아니라
// 등록된 일정을 달력 위에 표시하는 수준의 뷰.
function getMonthMatrix(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month - 1, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();
  const { membership: viewer, access } = await getViewerMenuAccess(
    clubId,
    user.id,
    "SCHEDULE"
  );
  if (!viewer) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">일정</h1>
        <MembershipRequiredNotice />
      </div>
    );
  }
  if (access === "NONE") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">일정</h1>
        <AccessDeniedNotice />
      </div>
    );
  }
  const canWrite = access === "READ_WRITE";
  const events = await prisma.event.findMany({
    where: { clubId },
    orderBy: { date: "asc" },
  });

  const sp = await searchParams;
  const view = sp.view === "calendar" ? "calendar" : "list";

  const now = new Date();
  const [yearStr, monthStr] = (sp.month ?? "").split("-");
  const year = Number(yearStr) || now.getFullYear();
  const month = Number(monthStr) || now.getMonth() + 1;
  const monthMatrix = getMonthMatrix(year, month);
  const prevMonth = shiftMonth(year, month, -1);
  const nextMonth = shiftMonth(year, month, 1);

  const eventsByDay = new Map<string, typeof events>();
  for (const event of events) {
    const key = dayKey(event.date);
    const list = eventsByDay.get(key) ?? [];
    list.push(event);
    eventsByDay.set(key, list);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">일정</h1>
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
          <Link
            href={`/clubs/${clubId}/schedule?view=list`}
            className={`px-3 py-1.5 ${
              view === "list" ? "bg-gray-900 text-white" : "bg-white text-gray-600"
            }`}
          >
            목록
          </Link>
          <Link
            href={`/clubs/${clubId}/schedule?view=calendar&month=${year}-${month}`}
            className={`px-3 py-1.5 ${
              view === "calendar" ? "bg-gray-900 text-white" : "bg-white text-gray-600"
            }`}
          >
            캘린더
          </Link>
        </div>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        일정을 등록하고, 각 일정별로 참석 여부를 관리할 수 있습니다.
      </p>

      {canWrite && (
        <div className="mb-4">
          <CreateEventForm clubId={clubId} />
        </div>
      )}

      {view === "calendar" ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <Link
              href={`/clubs/${clubId}/schedule?view=calendar&month=${prevMonth.year}-${prevMonth.month}`}
              className="text-sm text-gray-500 hover:text-gray-900 px-2"
            >
              ← 이전달
            </Link>
            <p className="font-semibold text-sm">
              {year}년 {month}월
            </p>
            <Link
              href={`/clubs/${clubId}/schedule?view=calendar&month=${nextMonth.year}-${nextMonth.month}`}
              className="text-sm text-gray-500 hover:text-gray-900 px-2"
            >
              다음달 →
            </Link>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-100 border border-gray-100 rounded-md overflow-hidden">
            {monthMatrix.flatMap((week, wi) =>
              week.map((date, di) => (
                <div
                  key={`${wi}-${di}`}
                  className="bg-white min-h-[72px] p-1.5 text-left align-top"
                >
                  {date && (
                    <>
                      <p className="text-xs text-gray-400 mb-1">{date.getDate()}</p>
                      <div className="space-y-0.5">
                        {(eventsByDay.get(dayKey(date)) ?? []).map((event) => (
                          <Link
                            key={event.id}
                            href={`/clubs/${clubId}/schedule/${event.id}`}
                            className="block truncate rounded bg-gray-900 text-white text-[10px] px-1 py-0.5 hover:bg-gray-700"
                          >
                            {event.title}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {events.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              등록된 일정이 없습니다. 위 버튼으로 일정을 추가해보세요.
            </div>
          )}
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between px-4 py-3 gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{event.title}</p>
                <p className="text-xs text-gray-400">{formatDate(event.date)}</p>
                {event.location && (
                  <p className="text-xs text-gray-400">장소: {event.location}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Link
                  href={`/clubs/${clubId}/schedule/${event.id}`}
                  className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-900 whitespace-nowrap"
                >
                  참석 관리
                </Link>
                {canWrite && (
                  <form action={deleteEvent}>
                    <input type="hidden" name="id" value={event.id} />
                    <input type="hidden" name="clubId" value={clubId} />
                    <button
                      type="submit"
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      삭제
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
