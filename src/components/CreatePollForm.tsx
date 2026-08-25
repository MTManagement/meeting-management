"use client";

import { useRef, useState } from "react";
import { createPollPost } from "@/app/clubs/[clubId]/board/actions";

export default function CreatePollForm({
  clubId,
  boardId,
  anonymous,
}: {
  clubId: string;
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
        {open ? "닫기" : "+ 투표 만들기"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={async (formData) => {
            await createPollPost(formData);
            formRef.current?.reset();
          }}
          className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-2"
        >
          <input type="hidden" name="clubId" value={clubId} />
          <input type="hidden" name="boardId" value={boardId} />
          <input
            type="hidden"
            name="boardAnonymous"
            value={anonymous ? "true" : "false"}
          />

          <div className="flex flex-wrap gap-2">
            <input
              name="title"
              placeholder="투표 제목 (질문)"
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

          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">
              선택지를 2개 이상 입력하세요 (빈 칸은 무시됩니다)
            </p>
            {["option1", "option2", "option3", "option4", "option5"].map(
              (name, i) => (
                <input
                  key={name}
                  name={name}
                  placeholder={`선택지 ${i + 1}`}
                  required={i < 2}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              )
            )}
          </div>

          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="allowMultiple"
              className="h-4 w-4 accent-gray-900"
            />
            복수 선택 허용
          </label>

          <button
            type="submit"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            투표 만들기
          </button>
        </form>
      )}
    </div>
  );
}
