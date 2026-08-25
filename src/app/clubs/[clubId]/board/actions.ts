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
