import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import CreateBoardForm from "@/components/CreateBoardForm";
import MembershipRequiredNotice from "@/components/MembershipRequiredNotice";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import { getViewerMenuAccess } from "@/lib/menuPermissions";
import { deleteBoard } from "./actions";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();
  const { membership: viewer, access } = await getViewerMenuAccess(
    clubId,
    user.id,
    "BOARD"
  );
  if (!viewer) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">게시판</h1>
        <MembershipRequiredNotice />
      </div>
    );
  }
  if (access === "NONE") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">게시판</h1>
        <AccessDeniedNotice />
      </div>
    );
  }
  const canWrite = access === "READ_WRITE";
  const boards = await prisma.board.findMany({
    where: { clubId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { posts: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">게시판</h1>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        용도(공지/자유), 글쓰기 권한, 익명 여부를 선택해서 게시판을 만들 수
        있습니다.
      </p>

      {canWrite && (
        <div className="mb-4">
          <CreateBoardForm clubId={clubId} />
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {boards.length === 0 && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">
            생성된 게시판이 없습니다. 위 버튼으로 게시판을 만들어보세요.
          </div>
        )}
        {boards.map((board) => (
          <div
            key={board.id}
            className="flex items-center justify-between px-4 py-3 gap-3"
          >
            <Link href={`/clubs/${clubId}/board/${board.id}`} className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{board.name}</p>
              <p className="text-xs text-gray-400">
                게시글 {board._count.posts}개
                {board.anonymous ? " · 익명" : ""}
                {board.allowMemberPost ? "" : " · 관리자만 작성"}
              </p>
            </Link>
            <div className="flex items-center gap-3 shrink-0">
              <span className="rounded-full bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
                {board.type}
              </span>
              {canWrite && (
                <form action={deleteBoard}>
                  <input type="hidden" name="id" value={board.id} />
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
