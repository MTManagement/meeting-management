"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMenuWrite } from "@/lib/menuPermissions";

export async function addMember(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  const role = (formData.get("role") as string)?.trim() || "회원";
  const phone = (formData.get("phone") as string)?.trim();

  if (!clubId || !name) return;
  await requireMenuWrite(clubId, "MEMBERS");

  await prisma.member.create({
    data: { clubId, name, role, phone },
  });

  revalidatePath(`/clubs/${clubId}/members`);
}

// 회원 강제 탈퇴 ("회원 목록" 메뉴 쓰기 권한 필요). 메인 관리자는 이 경로로 제거할 수 없다.
export async function deleteMember(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  if (!id || !clubId) return;
  await requireMenuWrite(clubId, "MEMBERS");

  const target = await prisma.member.findUnique({ where: { id } });
  if (!target || target.clubId !== clubId) return;
  if (target.grade === "MAIN_ADMIN") return;

  await prisma.member.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/members`);
  revalidatePath(`/clubs/${clubId}/settings`);
}

// 회원 목록 자유 컬럼 관리 (사전 정의 템플릿 대신 "컬럼명 추가 + 값 입력" 축소판)
export async function addMemberColumn(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const name = (formData.get("name") as string)?.trim();
  if (!clubId || !name) return;
  await requireMenuWrite(clubId, "MEMBERS");

  const count = await prisma.memberColumn.count({ where: { clubId } });
  await prisma.memberColumn.create({
    data: { clubId, name, order: count },
  });

  revalidatePath(`/clubs/${clubId}/members`);
}

export async function deleteMemberColumn(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const columnId = formData.get("columnId") as string;
  if (!clubId || !columnId) return;
  await requireMenuWrite(clubId, "MEMBERS");

  const column = await prisma.memberColumn.findUnique({ where: { id: columnId } });
  if (!column || column.clubId !== clubId) return;

  await prisma.memberColumn.delete({ where: { id: columnId } });

  revalidatePath(`/clubs/${clubId}/members`);
}

// 자유 컬럼 값 일괄 저장 (회원 x 컬럼 조합의 값을 한 번에 저장)
export async function saveMemberFields(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  if (!clubId) return;
  await requireMenuWrite(clubId, "MEMBERS");

  const memberIds = formData.getAll("memberId") as string[];
  const columnIds = formData.getAll("columnId") as string[];

  await prisma.$transaction(
    memberIds.flatMap((memberId) =>
      columnIds.map((columnId) => {
        const value =
          (formData.get(`field__${memberId}__${columnId}`) as string)?.trim() ??
          "";
        return prisma.memberFieldValue.upsert({
          where: { memberId_columnId: { memberId, columnId } },
          update: { value },
          create: { memberId, columnId, value },
        });
      })
    )
  );

  revalidatePath(`/clubs/${clubId}/members`);
}
