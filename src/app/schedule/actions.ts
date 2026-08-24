"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createEvent(formData: FormData) {
  const title = (formData.get("title") as string)?.trim();
  const dateStr = formData.get("date") as string;
  if (!title || !dateStr) return;

  const location = (formData.get("location") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const fee = (formData.get("fee") as string)?.trim() || null;
  const maxAttendeesRaw = formData.get("maxAttendees") as string;
  const maxAttendees = maxAttendeesRaw ? Number(maxAttendeesRaw) : null;
  const description = (formData.get("description") as string)?.trim() || null;

  await prisma.event.create({
    data: {
      title,
      date: new Date(dateStr),
      location,
      address,
      fee,
      maxAttendees,
      description,
    },
  });

  revalidatePath("/schedule");
}

export async function deleteEvent(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;

  await prisma.event.delete({ where: { id } });

  revalidatePath("/schedule");
}

export async function saveAttendance(formData: FormData) {
  const eventId = formData.get("eventId") as string;
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

  revalidatePath(`/schedule/${eventId}`);
}
