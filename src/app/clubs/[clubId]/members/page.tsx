import Link from "next/link";
import { prisma } from "@/lib/prisma";
import AddMemberForm from "@/components/AddMemberForm";
import { deleteMember } from "./actions";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const members = await prisma.member.findMany({
    where: { clubId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">회원 목록</h1>
        <Link
          href={`/clubs/${clubId}/dues`}
          className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-900"
        >
          회비 납부현황 관리 →
        </Link>
      </div>
      <p className="text-gray-600 mb-4 text-sm">
        실제 DB에 저장되는 회원 목록입니다. 추후 사전 정의 템플릿 + 컬럼명
        커스터마이징 기능이 붙을 예정입니다. 회비 납부현황은 별도 관리 화면에서
        확인할 수 있습니다.
      </p>

      <div className="mb-4">
        <AddMemberForm clubId={clubId} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium">직책</th>
              <th className="px-4 py-3 font-medium">연락처</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  등록된 회원이 없습니다. 위 버튼으로 회원을 추가해보세요.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">{m.name}</td>
                <td className="px-4 py-3">{m.role}</td>
                <td className="px-4 py-3">{m.phone}</td>
                <td className="px-4 py-3 text-right">
                  <form action={deleteMember}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="clubId" value={clubId} />
                    <button
                      type="submit"
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
