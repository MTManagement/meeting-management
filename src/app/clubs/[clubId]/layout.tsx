import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isAdminGrade, isMainAdminGrade } from "@/lib/permissions";
import AppShell from "@/components/AppShell";

export default async function ClubLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clubId: string }>;
}) {
  const user = await requireUser();
  const { clubId } = await params;

  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) notFound();

  const [membership, pendingRequest, boards] = await Promise.all([
    prisma.member.findFirst({ where: { clubId, userId: user.id } }),
    prisma.membershipRequest.findFirst({
      where: { clubId, userId: user.id, status: "PENDING" },
    }),
    prisma.board.findMany({
      where: { clubId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <AppShell
      clubId={club.id}
      clubName={club.name}
      isMember={!!membership}
      isAdmin={!!membership && isAdminGrade(membership.grade)}
      isMainAdmin={!!membership && isMainAdminGrade(membership.grade)}
      joinPending={!!pendingRequest}
      boards={boards}
    >
      {children}
    </AppShell>
  );
}
