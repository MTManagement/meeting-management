"use client";

import { useRef, useState } from "react";
import { createBoard } from "@/app/board/actions";

export default function CreateBoardForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        {open ? "닫기" : "+ 게시판 만들기"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={async (formData) => {
            await createBoard(formData);
            formRef.current?.reset();
          }}
          className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-3"
        >
          <input
            name="name"
            placeholder="게시판 이름 (예: 공지사항)"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              용도
              <select
                name="type"
                defaultValue="자유"
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="공지">공지 게시판</option>
                <option value="자유">자유 게시판</option>
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
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            만들기
          </button>
        </form>
      )}
    </div>
  );
}
