"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function addMember(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  const role = (formData.get("role") as string)?.trim() || "회원";
  const phone = (formData.get("phone") as string)?.trim();

  if (!clubId || !name) return;

  await prisma.member.create({
    data: { clubId, name, role, phone },
  });

  revalidatePath(`/clubs/${clubId}/members`);
}

export async function deleteMember(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  if (!id) return;

  await prisma.member.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/members`);
}
