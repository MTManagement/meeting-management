import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// grade: "MAIN_ADMIN"(모임 생성자, 1명) | "ADMIN"(위임받은 관리자권한자) | "MEMBER"(일반 회원)
export type Grade = "MAIN_ADMIN" | "ADMIN" | "MEMBER";

export const GRADE_LABEL: Record<string, string> = {
  MAIN_ADMIN: "관리자",
  ADMIN: "관리자권한자",
  MEMBER: "일반 회원",
};

export function gradeLabel(grade: string) {
  return GRADE_LABEL[grade] ?? grade;
}

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

// 권한 등급(grade) 컬럼이 추가되기 전에 생성된 모임은 기존 회원 행이
// 스키마 기본값("MEMBER")으로 백필되어 메인 관리자가 없는 상태가 될 수 있다.
// 그런 모임을 발견하면 가장 먼저 가입한 회원(=생성자)을 메인 관리자로 승격한다.
export async function ensureMainAdmin(clubId: string) {
  const existingMainAdmin = await prisma.member.findFirst({
    where: { clubId, grade: "MAIN_ADMIN" },
  });
  if (existingMainAdmin) return;

  const earliestMember = await prisma.member.findFirst({
    where: { clubId },
    orderBy: { createdAt: "asc" },
  });
  if (!earliestMember) return;

  await prisma.member.update({
    where: { id: earliestMember.id },
    data: { grade: "MAIN_ADMIN" },
  });
}
