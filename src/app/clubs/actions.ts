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
          phone: "",
        },
      },
    },
  });

  redirect(`/clubs/${club.id}`);
}

export async function joinClub(formData: FormData) {
  const user = await requireUser();
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  const existing = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (existing) {
    redirect(`/clubs/${clubId}`);
  }

  await prisma.member.create({
    data: {
      clubId,
      userId: user.id,
      name: user.name,
      role: "회원",
      phone: "",
    },
  });

  revalidatePath("/");
  redirect(`/clubs/${clubId}`);
}
