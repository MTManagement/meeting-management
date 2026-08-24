"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function addMember(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const role = (formData.get("role") as string)?.trim() || "회원";
  const phone = (formData.get("phone") as string)?.trim();
  const duesStatus = (formData.get("duesStatus") as string) || "미납";

  if (!name) return;

  await prisma.member.create({
    data: { name, role, phone, duesStatus },
  });

  revalidatePath("/members");
}

export async function deleteMember(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;

  await prisma.member.delete({ where: { id } });

  revalidatePath("/members");
}
