import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
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

  const membership = await prisma.member.findFirst({
    where: { clubId, userId: user.id },
  });

  return (
    <AppShell clubId={club.id} clubName={club.name} isMember={!!membership}>
      {children}
    </AppShell>
  );
}
