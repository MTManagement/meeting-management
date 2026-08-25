import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export type MenuType = "MEMBERS" | "DUES" | "BOARD" | "SCHEDULE";
export type Access = "READ_WRITE" | "READ_ONLY" | "NONE";

export const MENU_TYPES: MenuType[] = ["MEMBERS", "DUES", "BOARD", "SCHEDULE"];

export const MENU_TYPE_LABEL: Record<MenuType, string> = {
  MEMBERS: "회원 목록",
  DUES: "회비 납부현황",
  BOARD: "게시판",
  SCHEDULE: "일정",
};

export const ACCESS_LABEL: Record<Access, string> = {
  READ_WRITE: "읽기/쓰기",
  READ_ONLY: "읽기만",
  NONE: "접근불가",
};

// 등급별로 MenuPermission 행이 아직 없을 때 적용되는 기본값.
// (관리자권한자는 기본적으로 메인 관리자와 동일하게 전체 허용,
//  일반 회원은 조회만 가능 - 지금까지의 하드코딩 동작과 동일)
const DEFAULT_ACCESS: Record<string, Access> = {
  ADMIN: "READ_WRITE",
  MEMBER: "READ_ONLY",
};

export async function getMenuAccess(
  clubId: string,
  grade: string,
  menuType: MenuType
): Promise<Access> {
  if (grade === "MAIN_ADMIN") return "READ_WRITE";

  const row = await prisma.menuPermission.findUnique({
    where: { clubId_grade_menuType: { clubId, grade, menuType } },
  });
  if (row) return row.access as Access;

  return DEFAULT_ACCESS[grade] ?? "NONE";
}

// 페이지에서 리다이렉트 없이 현재 사용자의 등급/메뉴 접근권한을 조회할 때 사용.
export async function getViewerMenuAccess(
  clubId: string,
  userId: string,
  menuType: MenuType
): Promise<{ membership: Awaited<ReturnType<typeof getMembership>>; access: Access }> {
  const membership = await getMembership(clubId, userId);
  if (!membership) return { membership: null, access: "NONE" };
  const access = await getMenuAccess(clubId, membership.grade, menuType);
  return { membership, access };
}

function getMembership(clubId: string, userId: string) {
  return prisma.member.findFirst({ where: { clubId, userId } });
}

// 서버 액션에서 "이 메뉴에 쓰기 권한이 있어야만" 통과시킬 때 사용.
export async function requireMenuWrite(clubId: string, menuType: MenuType) {
  const user = await requireUser();
  const membership = await getMembership(clubId, user.id);
  if (!membership) redirect(`/clubs/${clubId}`);

  const access = await getMenuAccess(clubId, membership.grade, menuType);
  if (access !== "READ_WRITE") redirect(`/clubs/${clubId}`);

  return { user, membership };
}
