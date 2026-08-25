"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoard } from "@/app/clubs/[clubId]/board/actions";

type MenuType = "board" | "schedule";

export default function AddMenuButton({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MenuType>("board");
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setType("board");
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
      >
        + 메뉴 추가
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">메뉴 추가</h2>
              <button
                type="button"
                onClick={close}
                aria-label="닫기"
                className="text-gray-400"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setType("board")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  type === "board"
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                게시판
              </button>
              <button
                type="button"
                onClick={() => setType("schedule")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  type === "schedule"
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                일정
              </button>
            </div>

            {type === "board" ? (
              <form
                ref={formRef}
                action={async (formData) => {
                  await createBoard(formData);
                  formRef.current?.reset();
                  close();
                  router.refresh();
                }}
                className="space-y-3"
              >
                <input type="hidden" name="clubId" value={clubId} />
                <input
                  name="name"
                  placeholder="게시판 이름 (예: 공지사항)"
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />

                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    용도
                    <select
                      name="type"
                      defaultValue="자유"
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="공지">공지 게시판</option>
                      <option value="자유">자유 게시판</option>
                      <option value="투표">투표 게시판</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="allowMemberPost"
                      defaultChecked
                      className="h-4 w-4 accent-gray-900"
                    />
                    회원 글쓰기 허용
                  </label>

                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="anonymous"
                      className="h-4 w-4 accent-gray-900"
                    />
                    익명 게시판
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-md bg-gray-900 text-white text-sm px-4 py-2"
                >
                  게시판 만들기
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  일정 메뉴는 이미 사이드바에 기본으로 제공됩니다. 새 일정은
                  일정 메뉴에서 바로 등록해주세요.
                </p>
                <a
                  href={`/clubs/${clubId}/schedule`}
                  className="block text-center rounded-md bg-gray-900 text-white text-sm px-4 py-2"
                  onClick={close}
                >
                  일정 메뉴로 이동
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
