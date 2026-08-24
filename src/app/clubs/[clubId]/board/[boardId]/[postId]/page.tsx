import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth";
import CreateCommentForm from "@/components/CreateCommentForm";

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

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ clubId: string; boardId: string; postId: string }>;
}) {
  const { clubId, boardId, postId } = await params;
  await requireMembership(clubId);

  const [board, post] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId } }),
    prisma.post.findUnique({
      where: { id: postId },
      include: { comments: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  if (!board || board.clubId !== clubId || !post || post.boardId !== boardId)
    notFound();

  return (
    <div>
      <Link
        href={`/clubs/${clubId}/board/${boardId}`}
        className="text-sm text-gray-500 hover:text-gray-900 mb-3 inline-block"
      >
        ← {board.name}
      </Link>

      <div className="rounded-lg border border-gray-200 bg-white p-5 mb-4">
        <h1 className="text-xl font-bold mb-1">{post.title}</h1>
        <p className="text-xs text-gray-400 mb-4">
          {post.authorName} · {formatDate(post.createdAt)}
        </p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {post.content}
        </p>
      </div>

      <h2 className="font-semibold mb-2 text-sm">
        댓글 {post.comments.length}개
      </h2>

      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-4">
        {post.comments.length === 0 && (
          <div className="px-4 py-4 text-center text-gray-400 text-sm">
            첫 댓글을 남겨보세요.
          </div>
        )}
        {post.comments.map((comment) => (
          <div key={comment.id} className="px-4 py-3">
            <p className="text-sm text-gray-700">{comment.content}</p>
            <p className="text-xs text-gray-400 mt-1">
              {comment.authorName} · {formatDate(comment.createdAt)}
            </p>
          </div>
        ))}
      </div>

      <CreateCommentForm
        clubId={clubId}
        boardId={boardId}
        postId={postId}
        anonymous={board.anonymous}
      />
    </div>
  );
}
