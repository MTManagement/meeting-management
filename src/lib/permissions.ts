import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// grade: "MAIN_ADMIN"(모임 생성자, 1명) | "ADMIN"(위임받은 관리자권한자) | "MEMBER"(일반 회원)
export type Grade = "MAIN_ADMIN" | "ADMIN" | "MEMBER";

export function isAdminGrade(grade: string) {
  return grade === "MAIN_ADMIN" || grade === "ADMIN";
}

export function isMainAdminGrade(grade: string) {
  return grade === "MAIN_ADMIN";
}

// 페이지/서버 액션에서 "관리자 이상"만 통과시킬 때 사용. 아니면 모임 소개로 돌려보낸다.
export async function requireAdmin(clubId: string) {
  const user = await requireUser();
  const membership = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (!membership || !isAdminGrade(membership.grade)) {
    redirect(`/clubs/${clubId}`);
  }
  return { user, membership };
}

// 메인 관리자만 가능한 동작(모임 삭제, 권한 위임/회수)에서 사용.
export async function requireMainAdmin(clubId: string) {
  const user = await requireUser();
  const membership = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });
  if (!membership || !isMainAdminGrade(membership.grade)) {
    redirect(`/clubs/${clubId}`);
  }
  return { user, membership };
}

// 리다이렉트 없이 현재 로그인 사용자의 가입 여부/등급을 조회할 때 사용 (사이드바, 잠금 안내 등).
export async function getViewerMembership(clubId: string, userId: string) {
  return prisma.member.findFirst({ where: { clubId, userId } });
}
