export type PeriodType = "YEARLY" | "HALF" | "QUARTER" | "MONTH" | "WEEK";

export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  YEARLY: "연간",
  HALF: "반기별",
  QUARTER: "분기별",
  MONTH: "월별",
  WEEK: "주별",
};

const PERIOD_TYPES: PeriodType[] = ["YEARLY", "HALF", "QUARTER", "MONTH", "WEEK"];

export function isPeriodType(value: string): value is PeriodType {
  return (PERIOD_TYPES as string[]).includes(value);
}

const PERIOD_COUNTS: Record<PeriodType, number> = {
  YEARLY: 1,
  HALF: 2,
  QUARTER: 4,
  MONTH: 12,
  WEEK: 53,
};

export function getPeriodLabel(periodType: PeriodType, index: number): string {
  switch (periodType) {
    case "YEARLY":
      return "연간";
    case "HALF":
      return index === 1 ? "상반기" : "하반기";
    case "QUARTER":
      return `${index}분기`;
    case "MONTH":
      return `${index}월`;
    case "WEEK":
      return `${index}주`;
  }
}

export function getPeriodIndexes(periodType: PeriodType): number[] {
  return Array.from({ length: PERIOD_COUNTS[periodType] }, (_, i) => i + 1);
}

export function cellKey(memberId: string, periodIndex: number): string {
  return `${memberId}__${periodIndex}`;
}
