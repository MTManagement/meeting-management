"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { requireMainAdmin } from "@/lib/permissions";

export async function deleteClub(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  // 모임 삭제는 메인 관리자만 가능
  await requireMainAdmin(clubId);

  await prisma.club.delete({ where: { id: clubId } });

  redirect("/home");
}

export async function leaveClub(formData: FormData) {
  const user = await requireUser();
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  const membership = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (!membership) redirect(`/clubs/${clubId}`);

  // 메인 관리자는 다른 사람에게 위임을 완료하기 전까지 탈퇴 불가
  if (membership.grade === "MAIN_ADMIN") {
    redirect(`/clubs/${clubId}?error=main_admin_cannot_leave`);
  }

  await prisma.member.deleteMany({
    where: { clubId, userId: user.id },
  });

  revalidatePath("/home");
  revalidatePath(`/clubs/${clubId}`);
  redirect(`/clubs/${clubId}`);
}
