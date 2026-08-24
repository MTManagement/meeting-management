"use client";

import { useRef } from "react";
import { createComment } from "@/app/clubs/[clubId]/board/actions";

export default function CreateCommentForm({
  clubId,
  boardId,
  postId,
  anonymous,
}: {
  clubId: string;
  boardId: string;
  postId: string;
  anonymous: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await createComment(formData);
        formRef.current?.reset();
      }}
      className="flex flex-wrap gap-2 items-start"
    >
      <input type="hidden" name="clubId" value={clubId} />
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="postId" value={postId} />
      <input
        type="hidden"
        name="boardAnonymous"
        value={anonymous ? "true" : "false"}
      />

      {!anonymous && (
        <input
          name="authorName"
          placeholder="이름"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm w-24"
        />
      )}
      <input
        name="content"
        placeholder="댓글을 입력하세요"
        required
        className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[160px]"
      />
      <button
        type="submit"
        className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
      >
        등록
      </button>
    </form>
  );
}
