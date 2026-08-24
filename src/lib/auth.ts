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

// 가입한 회원만 접근 가능한 탭(회원목록/회비/게시판/일정)에서 사용.
// 로그인은 했지만 해당 모임에 가입하지 않은 경우 모임 소개 페이지로 돌려보낸다.
export async function requireMembership(clubId: string) {
  const user = await requireUser();

  const membership = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (!membership) redirect(`/clubs/${clubId}`);

  return { user, membership };
}
