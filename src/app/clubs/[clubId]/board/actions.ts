"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isAdminGrade } from "@/lib/permissions";
import { requireMenuWrite } from "@/lib/menuPermissions";

async function requirePostAccess(clubId: string, boardId: string) {
  const user = await requireUser();
  const [membership, board] = await Promise.all([
    prisma.member.findFirst({ where: { clubId, userId: user.id } }),
    prisma.board.findUnique({ where: { id: boardId } }),
  ]);
  if (!membership || !board) return null;
  if (!board.allowMemberPost && !isAdminGrade(membership.grade)) return null;
  return { user, membership, board };
}

export async function createBoard(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  const type = (formData.get("type") as string) || "자유";
  const allowMemberPost = formData.get("allowMemberPost") === "on";
  const anonymous = formData.get("anonymous") === "on";

  if (!clubId || !name) return;
  await requireMenuWrite(clubId, "BOARD");

  await prisma.board.create({
    data: { clubId, name, type, allowMemberPost, anonymous },
  });

  revalidatePath(`/clubs/${clubId}/board`);
  revalidatePath(`/clubs/${clubId}`, "layout");
}

export async function deleteBoard(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  if (!id || !clubId) return;
  await requireMenuWrite(clubId, "BOARD");

  await prisma.board.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/board`);
  revalidatePath(`/clubs/${clubId}`, "layout");
}

export async function createPost(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const boardId = formData.get("boardId") as string;
  const title = (formData.get("title") as string)?.trim();
  const content = (formData.get("content") as string)?.trim();
  const anonymous = formData.get("boardAnonymous") === "true";
  const authorInput = (formData.get("authorName") as string)?.trim();

  if (!clubId || !boardId || !title || !content) return;
  const access = await requirePostAccess(clubId, boardId);
  if (!access) return;

  const authorName = anonymous ? "익명" : authorInput || "익명";

  await prisma.post.create({
    data: { boardId, title, content, authorName },
  });

  revalidatePath(`/clubs/${clubId}/board/${boardId}`);
}

// 투표 게시글 작성. option1~5 중 값이 있는 것만 선택지로 저장.
export async function createPollPost(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const boardId = formData.get("boardId") as string;
  const title = (formData.get("title") as string)?.trim();
  const allowMultiple = formData.get("allowMultiple") === "on";
  const anonymous = formData.get("boardAnonymous") === "true";
  const authorInput = (formData.get("authorName") as string)?.trim();

  const options = ["option1", "option2", "option3", "option4", "option5"]
    .map((key) => (formData.get(key) as string)?.trim())
    .filter((v): v is string => !!v);

  if (!clubId || !boardId || !title || options.length < 2) return;
  const access = await requirePostAccess(clubId, boardId);
  if (!access) return;

  const authorName = anonymous ? "익명" : authorInput || "익명";

  await prisma.post.create({
    data: {
      boardId,
      title,
      content: "",
      authorName,
      isPoll: true,
      allowMultiple,
      pollOptions: {
        create: options.map((label, i) => ({ label, order: i })),
      },
    },
  });

  revalidatePath(`/clubs/${clubId}/board/${boardId}`);
}

// 투표 응답. 이미 그 선택지에 투표했으면 취소(토글). 단일 선택(allowMultiple=false)
// 게시물은 다른 선택지에 있던 기존 응답을 지우고 새로 선택한 것으로 교체한다.
export async function votePoll(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const boardId = formData.get("boardId") as string;
  const postId = formData.get("postId") as string;
  const optionId = formData.get("optionId") as string;
  if (!clubId || !boardId || !postId || !optionId) return;

  const access = await requirePostAccess(clubId, boardId);
  if (!access) return;

  const [post, option] = await Promise.all([
    prisma.post.findUnique({ where: { id: postId } }),
    prisma.pollOption.findUnique({ where: { id: optionId } }),
  ]);
  if (!post || !post.isPoll || !option || option.postId !== postId) return;

  const existingVote = await prisma.pollVote.findUnique({
    where: { optionId_memberId: { optionId, memberId: access.membership.id } },
  });

  if (existingVote) {
    await prisma.pollVote.delete({ where: { id: existingVote.id } });
  } else {
    if (!post.allowMultiple) {
      await prisma.pollVote.deleteMany({
        where: {
          memberId: access.membership.id,
          option: { postId },
        },
      });
    }
    await prisma.pollVote.create({
      data: { optionId, memberId: access.membership.id },
    });
  }

  revalidatePath(`/clubs/${clubId}/board/${boardId}/${postId}`);
}

export async function deletePost(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  const boardId = formData.get("boardId") as string;
  if (!id) return;

  await prisma.post.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/board/${boardId}`);
}

export async function createComment(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const postId = formData.get("postId") as string;
  const boardId = formData.get("boardId") as string;
  const content = (formData.get("content") as string)?.trim();
  const anonymous = formData.get("boardAnonymous") === "true";
  const authorInput = (formData.get("authorName") as string)?.trim();

  if (!clubId || !boardId || !postId || !content) return;
  const access = await requirePostAccess(clubId, boardId);
  if (!access) return;

  const authorName = anonymous ? "익명" : authorInput || "익명";

  await prisma.comment.create({
    data: { postId, content, authorName },
  });

  revalidatePath(`/clubs/${clubId}/board/${boardId}/${postId}`);
}
