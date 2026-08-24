"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const TABS = [
  { href: "/", label: "동호회 소개" },
  { href: "/members", label: "회원 목록" },
  { href: "/board", label: "게시판" },
  { href: "/schedule", label: "일정" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col p-2 gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={onNavigate}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen w-full bg-slate-200 md:flex">
      {/* 모바일 상단 바 */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <div>
          <p className="text-xs text-gray-400">모임 이름 (가칭)</p>
          <p className="font-semibold text-gray-900">우리 동호회</p>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="메뉴 열기"
          className="rounded-md border border-gray-200 p-2 text-gray-600"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* 모바일 슬라이드 메뉴 */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 bg-white shadow-lg">
            <div className="flex items-center justify-between px-4 py-5 border-b border-gray-200">
              <p className="font-semibold text-gray-900">우리 동호회</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="메뉴 닫기"
                className="text-gray-400"
              >
                ✕
              </button>
            </div>
            <NavLinks onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* 데스크톱 사이드바 */}
      <aside className="hidden w-56 shrink-0 border-r border-gray-200 bg-white md:block">
        <div className="px-4 py-5 border-b border-gray-200">
          <p className="text-sm text-gray-400">모임 이름 (가칭)</p>
          <p className="font-semibold text-gray-900">우리 동호회</p>
        </div>
        <NavLinks />
      </aside>

      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
