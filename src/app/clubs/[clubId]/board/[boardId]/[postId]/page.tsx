import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth";
import CreateCommentForm from "@/components/CreateCommentForm";
import { votePoll } from "../../actions";

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
  const { membership } = await requireMembership(clubId);

  const [board, post] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId } }),
    prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: { orderBy: { createdAt: "asc" } },
        pollOptions: {
          orderBy: { order: "asc" },
          include: { votes: true },
        },
      },
    }),
  ]);

  if (!board || board.clubId !== clubId || !post || post.boardId !== boardId)
    notFound();

  const totalVotes = post.pollOptions.reduce(
    (sum, opt) => sum + opt.votes.length,
    0
  );

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
        {post.isPoll ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 mb-2">
              {post.allowMultiple ? "복수 선택 가능" : "하나만 선택 가능"} ·
              참여 {totalVotes}표
            </p>
            {post.pollOptions.map((option) => {
              const voted = option.votes.some(
                (v) => v.memberId === membership.id
              );
              const pct =
                totalVotes === 0
                  ? 0
                  : Math.round((option.votes.length / totalVotes) * 100);
              return (
                <form key={option.id} action={votePoll}>
                  <input type="hidden" name="clubId" value={clubId} />
                  <input type="hidden" name="boardId" value={boardId} />
                  <input type="hidden" name="postId" value={postId} />
                  <input type="hidden" name="optionId" value={option.id} />
                  <button
                    type="submit"
                    className={`w-full text-left rounded-md border px-3 py-2 text-sm ${
                      voted
                        ? "border-gray-900 bg-gray-50"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span>
                        {voted && "✓ "}
                        {option.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        {option.votes.length}표 ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-gray-900"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                </form>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {post.content}
          </p>
        )}
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
