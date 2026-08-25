import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isAdminGrade } from "@/lib/permissions";
import CreateEventForm from "@/components/CreateEventForm";
import MembershipRequiredNotice from "@/components/MembershipRequiredNotice";
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

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();
  const viewer = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (!viewer) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">일정</h1>
        <MembershipRequiredNotice />
      </div>
    );
  }
  const isAdmin = isAdminGrade(viewer.grade);
  const events = await prisma.event.findMany({
    where: { clubId },
    orderBy: { date: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">일정</h1>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        일정을 등록하고, 각 일정별로 참석 여부를 관리할 수 있습니다.
      </p>

      {isAdmin && (
        <div className="mb-4">
          <CreateEventForm clubId={clubId} />
        </div>
      )}

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
              {isAdmin && (
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
    </div>
  );
}
