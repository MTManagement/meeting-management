"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function deleteClub(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;

  await prisma.club.delete({ where: { id: clubId } });

  redirect("/");
}
