"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function createProject(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;

  const project = await prisma.project.create({
    data: { name, ownerId: user.id },
  });

  redirect(`/project/${project.id}`);
}
