import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 모임 메인(대시보드) - 위젯 기반 대시보드는 추후 별도 설계 예정.
// 지금은 사이드바 항목과 라우트만 마련해둔 임시 화면.
export default async function ClubMainPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">{club.name}</h1>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 px-6 py-16 text-center">
        <p className="text-gray-400 text-sm">
          모임 메인 대시보드는 준비 중입니다.
        </p>
        <p className="text-gray-400 text-xs mt-1">
          공지·일정 위젯 등을 한눈에 모아 보여줄 예정입니다.
        </p>
      </div>
    </div>
  );
}
