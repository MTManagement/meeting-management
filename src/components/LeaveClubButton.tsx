"use client";

import { leaveClub } from "@/app/clubs/[clubId]/actions";

export default function LeaveClubButton({ clubId }: { clubId: string }) {
  return (
    <form
      action={leaveClub}
      onSubmit={(e) => {
        if (!confirm("이 모임에서 탈퇴하시겠습니까?")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="clubId" value={clubId} />
      <button
        type="submit"
        className="w-full text-left rounded-md px-3 py-2 text-xs text-gray-400 hover:bg-gray-100"
      >
        모임 탈퇴하기
      </button>
    </form>
  );
}
