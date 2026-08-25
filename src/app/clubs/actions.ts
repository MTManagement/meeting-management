"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function createClub(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return;

  const existingClub = await prisma.club.findUnique({ where: { name } });
  if (existingClub) {
    redirect(`/clubs?error=duplicate&name=${encodeURIComponent(name)}`);
  }

  const club = await prisma.club.create({
    data: {
      name,
      description,
      members: {
        create: {
          userId: user.id,
          name: user.name,
          role: "총무",
          grade: "MAIN_ADMIN",
          phone: "",
        },
      },
    },
  });

  redirect(`/clubs/${club.id}`);
}

// 가입 신청(승인제). 이미 가입돼 있으면 무시, 대기중이면 무시,
// 과거에 거절된 적이 있으면 재신청으로 대기 상태로 되돌린다.
export async function requestJoin(formData: FormData) {
  const user = await requireUser();
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  const existingMember = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (existingMember) {
    redirect(`/clubs/${clubId}`);
  }

  await prisma.membershipRequest.upsert({
    where: { clubId_userId: { clubId, userId: user.id } },
    update: { status: "PENDING" },
    create: { clubId, userId: user.id, status: "PENDING" },
  });

  revalidatePath("/clubs");
  revalidatePath(`/clubs/${clubId}`);
  redirect(`/clubs/${clubId}`);
}
