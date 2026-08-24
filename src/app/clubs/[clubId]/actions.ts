"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function deleteClub(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  await prisma.club.delete({ where: { id: clubId } });

  redirect("/home");
}

export async function leaveClub(formData: FormData) {
  const user = await requireUser();
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  await prisma.member.deleteMany({
    where: { clubId, userId: user.id },
  });

  revalidatePath("/home");
  revalidatePath(`/clubs/${clubId}`);
  redirect(`/clubs/${clubId}`);
}
