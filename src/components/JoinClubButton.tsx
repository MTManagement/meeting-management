import { joinClub } from "@/app/clubs/actions";

export default function JoinClubButton({ clubId }: { clubId: string }) {
  return (
    <form action={joinClub}>
      <input type="hidden" name="clubId" value={clubId} />
      <button
        type="submit"
        className="w-full rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        모임 가입하기
      </button>
    </form>
  );
}
