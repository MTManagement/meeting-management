const DUMMY_MEMBERS = [
  { name: "김철수", role: "회장", phone: "010-1234-5678", dues: "완납" },
  { name: "이영희", role: "총무", phone: "010-2345-6789", dues: "완납" },
  { name: "박민수", role: "회원", phone: "010-3456-7890", dues: "미납" },
  { name: "정수진", role: "회원", phone: "010-4567-8901", dues: "완납" },
];

export default function MembersPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">회원 목록</h1>
        <button className="rounded-md bg-gray-900 text-white text-sm px-3 py-2">
          + 회원 추가
        </button>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        엑셀 스타일 테이블 (예시 데이터). 추후 사전 정의 템플릿 + 컬럼명
        커스터마이징 기능이 붙을 예정입니다.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium">직책</th>
              <th className="px-4 py-3 font-medium">연락처</th>
              <th className="px-4 py-3 font-medium">회비 납부현황</th>
            </tr>
          </thead>
          <tbody>
            {DUMMY_MEMBERS.map((m) => (
              <tr key={m.name} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">{m.name}</td>
                <td className="px-4 py-3">{m.role}</td>
                <td className="px-4 py-3">{m.phone}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      m.dues === "완납"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {m.dues}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
