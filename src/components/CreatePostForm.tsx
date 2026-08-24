"use client";

import { useRef, useState } from "react";
import { createPost } from "@/app/board/actions";

export default function CreatePostForm({
  boardId,
  anonymous,
}: {
  boardId: string;
  anonymous: boolean;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        {open ? "닫기" : "+ 글쓰기"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={async (formData) => {
            await createPost(formData);
            formRef.current?.reset();
          }}
          className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-2"
        >
          <input type="hidden" name="boardId" value={boardId} />
          <input
            type="hidden"
            name="boardAnonymous"
            value={anonymous ? "true" : "false"}
          />

          <div className="flex flex-wrap gap-2">
            <input
              name="title"
              placeholder="제목"
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[160px]"
            />
            {!anonymous && (
              <input
                name="authorName"
                placeholder="작성자 이름"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm w-32"
              />
            )}
          </div>

          <textarea
            name="content"
            placeholder="내용을 입력하세요"
            required
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />

          <button
            type="submit"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            등록
          </button>
        </form>
      )}
    </div>
  );
}
