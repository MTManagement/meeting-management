import Link from "next/link";

const FEATURES = [
  {
    title: "회원 관리",
    desc: "회원 명단을 엑셀처럼 한눈에 관리하고, 언제든 새 회원을 추가하세요.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
      />
    ),
  },
  {
    title: "회비 정산",
    desc: "연/반기/분기/월/주 단위로 회비 납부 현황을 표로 체크하고 저장하세요.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
      />
    ),
  },
  {
    title: "일정 · 출석 관리",
    desc: "모임 일정을 등록하고, 회원별 참석 여부를 손쉽게 관리하세요.",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  },
  {
    title: "게시판 · 소통",
    desc: "공지·자유 게시판을 만들고 댓글로 소통하세요. 익명 옵션도 지원합니다.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
      />
    ),
  },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      {children}
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 상단 네비게이션 */}
      <header className="mx-auto max-w-5xl px-4 py-5 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-gray-900">
          SNAPHY
        </span>
        <Link
          href="/login"
          className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
        >
          로그인
        </Link>
      </header>

      {/* 히어로 섹션 */}
      <section className="mx-auto max-w-3xl px-4 pt-16 pb-20 text-center">
        <p className="text-sm font-medium text-gray-400 mb-3">SNAPHY</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
          모임 관리를 더 편하게
        </h1>
        <p className="text-gray-500 text-base sm:text-lg mb-8">
          회원 명단, 회비 정산, 일정과 출석, 게시판까지 — 흩어져 있던 모임
          운영을 한 곳에서 관리하세요.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-gray-900 text-white text-sm px-6 py-3 font-medium"
        >
          무료로 시작하기
        </Link>
      </section>

      {/* 기능 소개 섹션 */}
      <section className="bg-slate-50 border-t border-gray-100">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-xl font-bold text-center text-gray-900 mb-2">
            이런 게 편해집니다
          </h2>
          <p className="text-center text-gray-500 text-sm mb-10">
            총무 혼자 엑셀과 카톡, 은행 앱을 오가며 하던 일을 한 페이지에서
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="w-10 h-10 rounded-md bg-gray-900 text-white flex items-center justify-center mb-4">
                  <Icon>{f.icon}</Icon>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{f.title}</h3>
                <p className="text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 하단 CTA */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-3">
          지금 바로 모임을 만들어보세요
        </h2>
        <p className="text-gray-500 text-sm mb-6">
          닉네임만으로 바로 시작할 수 있어요.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-gray-900 text-white text-sm px-6 py-3 font-medium"
        >
          시작하기
        </Link>
      </section>

      <footer className="border-t border-gray-100 py-6 text-center text-xs text-gray-400">
        SNAPHY · 모임 관리 플랫폼
        <span className="block mt-1 text-[10px] text-gray-300">
          deploy check 2026-08-25
        </span>
      </footer>
    </div>
  );
}
