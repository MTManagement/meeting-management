export default function AccessDeniedNotice() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 px-6 py-16 text-center">
      <p className="text-gray-500 text-sm font-medium">
        접근 권한이 없습니다.
      </p>
      <p className="text-gray-400 text-xs mt-1">
        이 메뉴는 관리자가 등급별 접근 권한을 제한해두었습니다.
      </p>
    </div>
  );
}
