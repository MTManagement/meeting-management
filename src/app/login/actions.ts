"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UID_COOKIE } from "@/lib/auth";

export async function guestLogin(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;

  const user = await prisma.user.create({ data: { name } });

  const cookieStore = await cookies();
  cookieStore.set(UID_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(UID_COOKIE);
  redirect("/login");
}
