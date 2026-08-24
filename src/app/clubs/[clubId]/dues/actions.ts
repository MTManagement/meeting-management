"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isPeriodType, getPeriodIndexes } from "@/lib/duesPeriods";

export async function saveDues(formData: FormData) {
  const clubId = formData.get("clubId") as string;
  const year = Number(formData.get("year"));
  const periodTypeRaw = formData.get("periodType") as string;

  if (!clubId || !year || !isPeriodType(periodTypeRaw)) return;
  const periodType = periodTypeRaw;

  const memberIds = formData.getAll("memberId") as string[];
  const indexes = getPeriodIndexes(periodType);

  await prisma.$transaction(
    memberIds.flatMap((memberId) =>
      indexes.map((periodIndex) => {
        const paid = formData.get(`paid__${memberId}__${periodIndex}`) === "on";
        return prisma.duesPayment.upsert({
          where: {
            memberId_year_periodType_periodIndex: {
              memberId,
              year,
              periodType,
              periodIndex,
            },
          },
          update: { paid },
          create: { memberId, year, periodType, periodIndex, paid },
        });
      })
    )
  );

  revalidatePath(`/clubs/${clubId}/dues`);
}
