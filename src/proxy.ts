import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const uid = request.cookies.get("uid")?.value;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);

  if (!uid && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // uid 쿠키는 "있다"는 것만 확인할 뿐 유효성(DB에 실제 사용자가 있는지)은
  // 미들웨어에서 검사하지 않는다. 그 판단과 /login → /home 리다이렉트는
  // DB에 접근 가능한 로그인 페이지(login/page.tsx)에서 처리한다.
  // 여기서 무조건 리다이렉트하면, DB가 초기화되어 쿠키가 무효해졌을 때
  // /home ↔ /login 사이에서 무한 리다이렉트 루프가 생긴다.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
