"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMenuWrite } from "@/lib/menuPermissions";

export async function createEvent(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const title = (formData.get("title") as string)?.trim();
  const dateStr = formData.get("date") as string;
  if (!clubId || !title || !dateStr) return;
  await requireMenuWrite(clubId, "SCHEDULE");

  const location = (formData.get("location") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const fee = (formData.get("fee") as string)?.trim() || null;
  const maxAttendeesRaw = formData.get("maxAttendees") as string;
  const maxAttendees = maxAttendeesRaw ? Number(maxAttendeesRaw) : null;
  const description = (formData.get("description") as string)?.trim() || null;

  await prisma.event.create({
    data: {
      clubId,
      title,
      date: new Date(dateStr),
      location,
      address,
      fee,
      maxAttendees,
      description,
    },
  });

  revalidatePath(`/clubs/${clubId}/schedule`);
}

export async function deleteEvent(formData: FormData) {
  const id = formData.get("id") as string;
  const clubId = formData.get("clubId") as string;
  if (!id || !clubId) return;
  await requireMenuWrite(clubId, "SCHEDULE");

  await prisma.event.delete({ where: { id } });

  revalidatePath(`/clubs/${clubId}/schedule`);
}

export async function saveAttendance(formData: FormData) {
  const eventId = formData.get("eventId") as string;
  const clubId = formData.get("clubId") as string;
  if (!eventId) return;

  const memberIds = formData.getAll("memberId") as string[];

  await prisma.$transaction(
    memberIds.map((memberId) => {
      const status = (formData.get(`status__${memberId}`) as string) || "미정";
      return prisma.attendance.upsert({
        where: { eventId_memberId: { eventId, memberId } },
        update: { status },
        create: { eventId, memberId, status },
      });
    })
  );

  revalidatePath(`/clubs/${clubId}/schedule/${eventId}`);
}
