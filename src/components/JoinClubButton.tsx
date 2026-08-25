import { requestJoin } from "@/app/clubs/actions";

export default function JoinClubButton({
  clubId,
  pending,
}: {
  clubId: string;
  pending?: boolean;
}) {
  if (pending) {
    return (
      <button
        type="button"
        disabled
        className="w-full rounded-md bg-gray-200 text-gray-400 text-sm px-3 py-2 cursor-not-allowed"
      >
        승인 대기중
      </button>
    );
  }

  return (
    <form action={requestJoin}>
      <input type="hidden" name="clubId" value={clubId} />
      <button
        type="submit"
        className="w-full rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        모임 가입 신청
      </button>
    </form>
  );
}
