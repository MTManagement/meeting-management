"use client";

import { useRouter } from "next/navigation";
import type { PeriodType } from "@/lib/duesPeriods";
import { PERIOD_TYPE_LABELS } from "@/lib/duesPeriods";

export default function DuesControls({
  year,
  periodType,
}: {
  year: number;
  periodType: PeriodType;
}) {
  const router = useRouter();

  const goTo = (nextYear: number, nextUnit: PeriodType) => {
    router.push(`/dues?year=${nextYear}&unit=${nextUnit}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 mb-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(year - 1, periodType)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
        >
          ◀
        </button>
        <span className="font-medium text-sm w-14 text-center">{year}년</span>
        <button
          type="button"
          onClick={() => goTo(year + 1, periodType)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
        >
          ▶
        </button>
      </div>

      <select
        value={periodType}
        onChange={(e) => goTo(year, e.target.value as PeriodType)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
      >
        {Object.entries(PERIOD_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
