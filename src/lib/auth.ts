import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const UID_COOKIE = "uid";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const uid = cookieStore.get(UID_COOKIE)?.value;
  if (!uid) return null;

  const user = await prisma.user.findUnique({ where: { id: uid } });
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
