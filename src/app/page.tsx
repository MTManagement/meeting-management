export default function IntroPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">동호회 소개</h1>
      <p className="text-gray-600 mb-6">
        모임 소개, 회칙 등 정적 정보를 총무가 자유롭게 편집하는 페이지입니다.
        (아직 편집 기능은 연결되지 않은 미리보기 화면입니다.)
      </p>
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
        <h2 className="font-semibold">모임 소개</h2>
        <p className="text-sm text-gray-500">
          여기에 동호회 소개 문구, 활동 내용, 가입 안내 등이 표시됩니다.
        </p>
        <h2 className="font-semibold pt-2">회칙</h2>
        <p className="text-sm text-gray-500">
          회칙 내용이 이곳에 표시됩니다.
        </p>
      </div>
    </div>
  );
}
