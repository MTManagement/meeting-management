import Link from "next/link";

const FEATURES = [
  {
    title: "다평면 스케치",
    desc: "XY·YZ·XZ 기준 평면과 오프셋 평면을 자유롭게 추가해서, 원하는 위치에 선을 그으세요.",
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="14" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    title: "펜 또는 치수 입력",
    desc: "손그림처럼 자유롭게 긋거나, 길이·각도를 입력해 정밀하게 — 아이패드도 데스크톱도.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"
      />
    ),
  },
  {
    title: "그룹 이동·회전·스케일",
    desc: "가구나 벽을 그룹으로 묶어 통째로 옮기고, 그룹 안에 들어가 세부를 수정하세요.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8l-9-5-9 5 9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8"
      />
    ),
  },
  {
    title: "IGS로 저장·공유",
    desc: "그린 가구나 구조물을 IGS 파일로 저장해두고, 다른 프로젝트에서 그대로 불러와 재사용하세요.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
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
    <div className="min-h-screen bg-[#faf6ee]">
      {/* 상단 네비게이션 */}
      <header className="mx-auto max-w-5xl px-4 py-5 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-gray-900">
          PaperSketch
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
        <p className="text-sm font-medium text-gray-400 mb-3">PaperSketch</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
          종이에 연필로 그리듯,
          <br />
          공간을 3D로 스케치하세요
        </h1>
        <p className="text-gray-500 text-base sm:text-lg mb-8">
          평면 위에 선을 그으면 그대로 3D 구조가 됩니다. 복잡한 모델링
          없이, 인테리어를 그 자리에서 설명하고 셀프인테리어도 직접
          구상해보세요.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-gray-900 text-white text-sm px-6 py-3 font-medium"
        >
          무료로 시작하기
        </Link>
      </section>

      {/* 기능 소개 섹션 */}
      <section className="bg-white/60 border-t border-black/5">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-xl font-bold text-center text-gray-900 mb-2">
            이런 게 편해집니다
          </h2>
          <p className="text-center text-gray-500 text-sm mb-10">
            모델링 툴을 배우지 않아도, 그리는 대로 3D가 됩니다
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-black/10 bg-[#faf6ee] p-5"
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
          지금 바로 첫 스케치를 시작해보세요
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

      <footer className="border-t border-black/5 py-6 text-center text-xs text-gray-400">
        PaperSketch · 다평면 3D 스케치 도구
      </footer>
    </div>
  );
}
