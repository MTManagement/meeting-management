"use client";

import { useRef, useState } from "react";
import { addMember } from "@/app/members/actions";

export default function AddMemberForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        {open ? "닫기" : "+ 회원 추가"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={async (formData) => {
            await addMember(formData);
            formRef.current?.reset();
          }}
          className="mt-3 rounded-lg border border-gray-200 bg-white p-4 flex flex-wrap gap-2"
        >
          <input
            name="name"
            placeholder="이름"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[120px]"
          />
          <input
            name="role"
            placeholder="직책 (기본: 회원)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[120px]"
          />
          <input
            name="phone"
            placeholder="연락처"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[120px]"
          />
          <select
            name="duesStatus"
            defaultValue="미납"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="완납">완납</option>
            <option value="미납">미납</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-gray-900 text-white text-sm px-4 py-2"
          >
            저장
          </button>
        </form>
      )}
    </div>
  );
}
