"use client";

import { deleteClub } from "@/app/clubs/[clubId]/actions";

export default function DeleteClubButton({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  return (
    <form
      action={deleteClub}
      onSubmit={(e) => {
        if (
          !confirm(
            `"${clubName}" 모임을 삭제하시겠습니까?\n모임의 모든 회원/게시판/일정 데이터가 함께 삭제되며 되돌릴 수 없습니다.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="clubId" value={clubId} />
      <button
        type="submit"
        className="w-full text-left rounded-md px-3 py-2 text-xs text-red-400 hover:bg-red-50"
      >
        모임 삭제하기
      </button>
    </form>
  );
}
