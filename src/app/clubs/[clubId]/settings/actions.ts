"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMainAdmin } from "@/lib/permissions";

export async function approveMembershipRequest(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const requestId = formData.get("requestId") as string;
  if (!clubId || !requestId) return;
  await requireAdmin(clubId);

  const request = await prisma.membershipRequest.findUnique({
    where: { id: requestId },
  });
  if (!request || request.clubId !== clubId || request.status !== "PENDING") {
    return;
  }

  const applicant = await prisma.user.findUnique({
    where: { id: request.userId },
  });
  if (!applicant) return;

  await prisma.$transaction([
    prisma.member.create({
      data: {
        clubId,
        userId: applicant.id,
        name: applicant.name,
        role: "회원",
        grade: "MEMBER",
        phone: "",
      },
    }),
    prisma.membershipRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED" },
    }),
  ]);

  revalidatePath(`/clubs/${clubId}/settings`);
  revalidatePath(`/clubs/${clubId}`, "layout");
  revalidatePath("/home");
}

export async function rejectMembershipRequest(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const requestId = formData.get("requestId") as string;
  if (!clubId || !requestId) return;
  await requireAdmin(clubId);

  await prisma.membershipRequest.updateMany({
    where: { id: requestId, clubId, status: "PENDING" },
    data: { status: "REJECTED" },
  });

  revalidatePath(`/clubs/${clubId}/settings`);
}

// 관리자 권한 위임/회수. 메인 관리자만 가능하며, 메인 관리자 등급 자체는
// 이 화면에서 다루지 않는다 (위임 요청→수락 플로우는 1.5단계 범위).
export async function setMemberGrade(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const memberId = formData.get("memberId") as string;
  const grade = formData.get("grade") as string;
  if (!clubId || !memberId || (grade !== "ADMIN" && grade !== "MEMBER")) {
    return;
  }
  await requireMainAdmin(clubId);

  const target = await prisma.member.findUnique({ where: { id: memberId } });
  if (!target || target.clubId !== clubId || target.grade === "MAIN_ADMIN") {
    return;
  }

  await prisma.member.update({ where: { id: memberId }, data: { grade } });

  revalidatePath(`/clubs/${clubId}/settings`);
  revalidatePath(`/clubs/${clubId}/members`);
}

export async function updateClubInfo(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  if (!clubId || !name) return;
  await requireAdmin(clubId);

  const duplicate = await prisma.club.findUnique({ where: { name } });
  if (duplicate && duplicate.id !== clubId) {
    redirect(`/clubs/${clubId}/settings?error=duplicate`);
  }

  await prisma.club.update({
    where: { id: clubId },
    data: { name, description },
  });

  revalidatePath(`/clubs/${clubId}`, "layout");
  revalidatePath(`/clubs/${clubId}/settings`);
  revalidatePath("/home");
  redirect(`/clubs/${clubId}/settings?saved=1`);
}
