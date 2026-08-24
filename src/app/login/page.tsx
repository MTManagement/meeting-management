import { guestLogin } from "./actions";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-200 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="text-xl font-bold mb-1">SNAPHY</h1>
        <p className="text-sm text-gray-500 mb-6">
          닉네임을 입력하고 시작해보세요. (임시 게스트 로그인 · 추후
          카카오/구글 로그인 지원 예정)
        </p>

        <form action={guestLogin} className="space-y-3">
          <input
            name="name"
            placeholder="닉네임"
            required
            autoFocus
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            시작하기
          </button>
        </form>
      </div>
    </div>
  );
}
