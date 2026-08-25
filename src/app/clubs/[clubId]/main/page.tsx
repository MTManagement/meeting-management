import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// 모임 메인(대시보드) - 위젯 배치 커스터마이징은 1.5단계로 보류,
// 지금은 고정 레이아웃으로 실제 데이터를 채운다.
export default async function ClubMainPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) notFound();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [
    memberCount,
    dueMembers,
    duePayments,
    upcomingEvents,
    noticePosts,
    recentPosts,
    recentMembers,
  ] = await Promise.all([
    prisma.member.count({ where: { clubId } }),
    prisma.member.findMany({ where: { clubId }, select: { id: true } }),
    prisma.duesPayment.findMany({
      where: {
        year: currentYear,
        periodType: "MONTH",
        periodIndex: currentMonth,
        paid: true,
        member: { clubId },
      },
      select: { memberId: true },
    }),
    prisma.event.findMany({
      where: { clubId, date: { gte: now } },
      orderBy: { date: "asc" },
      take: 5,
    }),
    prisma.post.findMany({
      where: { board: { clubId, type: "공지" } },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { board: true },
    }),
    prisma.post.findMany({
      where: { board: { clubId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { board: true },
    }),
    prisma.member.findMany({
      where: { clubId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  const paidMemberIds = new Set(duePayments.map((p) => p.memberId));
  const paidCount = dueMembers.filter((m) => paidMemberIds.has(m.id)).length;

  type ActivityItem = {
    id: string;
    createdAt: Date;
    label: string;
    href?: string;
  };
  const activity: ActivityItem[] = [
    ...recentMembers.map((m) => ({
      id: `member-${m.id}`,
      createdAt: m.createdAt,
      label: `${m.name}님이 가입했습니다`,
    })),
    ...recentPosts.map((p) => ({
      id: `post-${p.id}`,
      createdAt: p.createdAt,
      label: `[${p.board.name}] ${p.title}`,
      href: `/clubs/${clubId}/board/${p.boardId}/${p.id}`,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{club.name}</h1>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-400 mb-1">회원 수</p>
          <p className="text-xl font-bold">{memberCount}명</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-400 mb-1">
            {currentMonth}월 회비 납부
          </p>
          <p className="text-xl font-bold">
            {paidCount} / {memberCount}명
          </p>
        </div>
      </div>

      {/* 공지 고정 위젯 */}
      {noticePosts.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-sm mb-3">📌 공지</h2>
          <div className="space-y-2">
            {noticePosts.map((post) => (
              <Link
                key={post.id}
                href={`/clubs/${clubId}/board/${post.boardId}/${post.id}`}
                className="block text-sm hover:text-gray-900"
              >
                <span className="text-gray-400 mr-1.5">
                  [{post.board.name}]
                </span>
                {post.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 다가오는 일정 위젯 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">다가오는 일정</h2>
          <Link
            href={`/clubs/${clubId}/schedule`}
            className="text-xs text-gray-400 hover:text-gray-900"
          >
            전체보기 →
          </Link>
        </div>
        {upcomingEvents.length === 0 ? (
          <p className="text-sm text-gray-400">예정된 일정이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map((event) => (
              <Link
                key={event.id}
                href={`/clubs/${clubId}/schedule/${event.id}`}
                className="flex items-center justify-between text-sm hover:text-gray-900"
              >
                <span className="truncate">{event.title}</span>
                <span className="text-gray-400 text-xs whitespace-nowrap ml-2">
                  {formatDateTime(event.date)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 최근 게시글 위젯 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">최근 게시글</h2>
          <Link
            href={`/clubs/${clubId}/board`}
            className="text-xs text-gray-400 hover:text-gray-900"
          >
            게시판 전체보기 →
          </Link>
        </div>
        {recentPosts.length === 0 ? (
          <p className="text-sm text-gray-400">등록된 게시글이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {recentPosts.map((post) => (
              <Link
                key={post.id}
                href={`/clubs/${clubId}/board/${post.boardId}/${post.id}`}
                className="flex items-center justify-between text-sm hover:text-gray-900"
              >
                <span className="truncate">
                  <span className="text-gray-400 mr-1.5">
                    [{post.board.name}]
                  </span>
                  {post.title}
                </span>
                <span className="text-gray-400 text-xs whitespace-nowrap ml-2">
                  {formatDate(post.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 최근 활동 피드 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-sm mb-3">최근 활동</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-400">최근 활동이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {activity.map((item) =>
              item.href ? (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block text-xs text-gray-500 hover:text-gray-900 truncate"
                >
                  {item.label}
                </Link>
              ) : (
                <p key={item.id} className="text-xs text-gray-500 truncate">
                  {item.label}
                </p>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
