"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import AddMenuButton from "@/components/AddMenuButton";
import DeleteClubButton from "@/components/DeleteClubButton";
import JoinClubButton from "@/components/JoinClubButton";
import LeaveClubButton from "@/components/LeaveClubButton";

type BoardSummary = { id: string; name: string };

function getTabs(clubId: string) {
  const base = `/clubs/${clubId}`;
  return [
    { href: `${base}/main`, label: "모임 메인" },
    { href: base, label: "모임 소개" },
    { href: `${base}/members`, label: "회원 목록" },
    { href: `${base}/dues`, label: "회비 납부현황" },
    { href: `${base}/board`, label: "게시판" },
    { href: `${base}/schedule`, label: "일정" },
  ];
}

function NavLinks({
  clubId,
  isAdmin,
  boards,
  onNavigate,
}: {
  clubId: string;
  isAdmin: boolean;
  boards: BoardSummary[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const tabs = getTabs(clubId);
  const boardBase = `/clubs/${clubId}/board`;

  return (
    <nav className="flex flex-col p-2 gap-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <div key={tab.href}>
            <Link
              href={tab.href}
              onClick={onNavigate}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </Link>
            {tab.href === boardBase && boards.length > 0 && (
              <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-gray-100 pl-2">
                {boards.map((board) => {
                  const href = `${boardBase}/${board.id}`;
                  const boardActive = pathname === href;
                  return (
                    <Link
                      key={board.id}
                      href={href}
                      onClick={onNavigate}
                      className={`truncate rounded-md px-2 py-1.5 text-xs transition-colors ${
                        boardActive
                          ? "bg-gray-100 text-gray-900 font-medium"
                          : "text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {board.name}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {isAdmin && (
        <>
          <div className="my-1 border-t border-gray-100" />
          <AddMenuButton clubId={clubId} />
          <Link
            href={`/clubs/${clubId}/settings`}
            onClick={onNavigate}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              pathname === `/clubs/${clubId}/settings`
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            설정
          </Link>
        </>
      )}
    </nav>
  );
}

function Footer({
  clubId,
  clubName,
  isMember,
  isMainAdmin,
  joinPending,
}: {
  clubId: string;
  clubName: string;
  isMember: boolean;
  isMainAdmin: boolean;
  joinPending: boolean;
}) {
  if (!isMember) {
    return (
      <div className="p-2 border-t border-gray-100 space-y-2">
        <JoinClubButton clubId={clubId} pending={joinPending} />
        <form action={logout}>
          <button
            type="submit"
            className="w-full text-left rounded-md px-3 py-2 text-xs text-gray-400 hover:bg-gray-100"
          >
            로그아웃
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-2 border-t border-gray-100 space-y-1">
      <LeaveClubButton clubId={clubId} />
      {isMainAdmin && <DeleteClubButton clubId={clubId} clubName={clubName} />}
      <form action={logout}>
        <button
          type="submit"
          className="w-full text-left rounded-md px-3 py-2 text-xs text-gray-400 hover:bg-gray-100"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}

export default function AppShell({
  clubId,
  clubName,
  isMember,
  isAdmin,
  isMainAdmin,
  joinPending,
  boards,
  children,
}: {
  clubId: string;
  clubName: string;
  isMember: boolean;
  isAdmin: boolean;
  isMainAdmin: boolean;
  joinPending: boolean;
  boards: BoardSummary[];
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen w-full bg-slate-200 md:flex">
      {/* 모바일 상단 바 */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <div>
          <Link href="/home" className="text-xs text-gray-400 hover:underline">
            ← 내 모임
          </Link>
          <p className="font-semibold text-gray-900">{clubName}</p>
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
          <div className="absolute left-0 top-0 h-full w-64 bg-white shadow-lg flex flex-col">
            <div className="flex items-center justify-between px-4 py-5 border-b border-gray-200">
              <p className="font-semibold text-gray-900">{clubName}</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="메뉴 닫기"
                className="text-gray-400"
              >
                ✕
              </button>
            </div>
            <NavLinks
              clubId={clubId}
              isAdmin={isAdmin}
              boards={boards}
              onNavigate={() => setMenuOpen(false)}
            />
            <div className="mt-auto">
              <Footer
                clubId={clubId}
                clubName={clubName}
                isMember={isMember}
                isMainAdmin={isMainAdmin}
                joinPending={joinPending}
              />
            </div>
          </div>
        </div>
      )}

      {/* 데스크톱 사이드바 */}
      <aside className="hidden w-56 shrink-0 border-r border-gray-200 bg-white md:flex md:flex-col">
        <div className="px-4 py-5 border-b border-gray-200">
          <Link href="/home" className="text-sm text-gray-400 hover:underline">
            ← 내 모임
          </Link>
          <p className="font-semibold text-gray-900">{clubName}</p>
        </div>
        <NavLinks clubId={clubId} isAdmin={isAdmin} boards={boards} />
        <div className="mt-auto">
          <Footer
            clubId={clubId}
            clubName={clubName}
            isMember={isMember}
            isMainAdmin={isMainAdmin}
            joinPending={joinPending}
          />
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
