"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";

export async function addMember(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  const role = (formData.get("role") as string)?.trim() || "회원";
  const phone = (formData.get("phone") as string)?.trim();

  if (!clubId || !name) return;
  await requireAdmin(clubId);

  await prisma.member.create({
    data: { clubId, name, role, phone },
  });

  revalidatePath(`/clubs/${clubId}/members`);
}

// 회원 강제 탈퇴 (관리자 전용). 메인 관리자는 이 경로로 제거할 수 없다.
export async function deleteMember(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  if (!id || !clubId) return;
  await requireAdmin(clubId);

  const target = await prisma.member.findUnique({ where: { id } });
  if (!target || target.clubId !== clubId) return;
  if (target.grade === "MAIN_ADMIN") return;

  await prisma.member.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/members`);
  revalidatePath(`/clubs/${clubId}/settings`);
}
