"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;

  await prisma.user.update({ where: { id: user.id }, data: { name } });

  revalidatePath("/home");
  revalidatePath("/mypage");
  redirect("/mypage?saved=1");
}
