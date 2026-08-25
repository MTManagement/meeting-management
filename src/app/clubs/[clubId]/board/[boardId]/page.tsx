import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth";
import CreatePostForm from "@/components/CreatePostForm";
import CreatePollForm from "@/components/CreatePollForm";
import { deletePost } from "../actions";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default async function BoardDetailPage({
  params,
}: {
  params: Promise<{ clubId: string; boardId: string }>;
}) {
  const { clubId, boardId } = await params;
  await requireMembership(clubId);

  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board || board.clubId !== clubId) notFound();

  const posts = await prisma.post.findMany({
    where: { boardId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { comments: true } } },
  });

  return (
    <div>
      <Link
        href={`/clubs/${clubId}/board`}
        className="text-sm text-gray-500 hover:text-gray-900 mb-3 inline-block"
      >
        ← 게시판 목록
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold">{board.name}</h1>
        <span className="rounded-full bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
          {board.type}
        </span>
      </div>
      <p className="text-gray-600 text-sm mb-4">
        {board.anonymous ? "익명 게시판" : "실명 게시판"} ·{" "}
        {board.allowMemberPost ? "회원 글쓰기 허용" : "관리자만 글쓰기 허용"}
      </p>

      <div className="mb-4">
        {board.type === "투표" ? (
          <CreatePollForm
            clubId={clubId}
            boardId={board.id}
            anonymous={board.anonymous}
          />
        ) : (
          <CreatePostForm
            clubId={clubId}
            boardId={board.id}
            anonymous={board.anonymous}
          />
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {posts.length === 0 && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">
            게시글이 없습니다. 위 버튼으로 글을 작성해보세요.
          </div>
        )}
        {posts.map((post) => (
          <div
            key={post.id}
            className="flex items-center justify-between px-4 py-3 gap-3"
          >
            <Link href={`/clubs/${clubId}/board/${board.id}/${post.id}`} className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">
                {post.isPoll && (
                  <span className="text-gray-400 font-normal mr-1">[투표]</span>
                )}
                {post.title}
                {post._count.comments > 0 && (
                  <span className="text-gray-400 font-normal">
                    {" "}
                    [{post._count.comments}]
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-400">
                {post.authorName} · {formatDate(post.createdAt)}
              </p>
            </Link>
            <form action={deletePost}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="boardId" value={board.id} />
              <input type="hidden" name="clubId" value={clubId} />
              <button
                type="submit"
                className="text-xs text-gray-400 hover:text-red-600 shrink-0"
              >
                삭제
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
