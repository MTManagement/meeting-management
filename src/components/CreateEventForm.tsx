"use client";

import { useRef, useState } from "react";
import { createEvent } from "@/app/clubs/[clubId]/schedule/actions";

const OPTIONAL_FIELDS = [
  { name: "location", label: "장소", type: "text", placeholder: "예: 강남역 스터디룸" },
  { name: "address", label: "주소", type: "text", placeholder: "예: 서울시 강남구 ..." },
  { name: "fee", label: "참석비", type: "text", placeholder: "예: 10,000원" },
  { name: "maxAttendees", label: "최대 인원", type: "number", placeholder: "예: 20" },
  { name: "description", label: "설명/메모", type: "textarea", placeholder: "안내 사항 등" },
] as const;

export default function CreateEventForm({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const toggle = (name: string) => {
    setEnabled((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-gray-900 text-white text-sm px-3 py-2"
      >
        {open ? "닫기" : "+ 일정 등록"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={async (formData) => {
            await createEvent(formData);
            formRef.current?.reset();
            setEnabled({});
          }}
          className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-3"
        >
          <input type="hidden" name="clubId" value={clubId} />
          <div className="flex flex-wrap gap-2">
            <input
              name="title"
              placeholder="일정 제목"
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1 min-w-[160px]"
            />
            <input
              name="date"
              type="datetime-local"
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400 mb-2">
              필요한 항목만 체크해서 추가하세요.
            </p>
            <div className="space-y-2">
              {OPTIONAL_FIELDS.map((field) => (
                <div key={field.name} className="flex items-start gap-2">
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 w-24 shrink-0 pt-2">
                    <input
                      type="checkbox"
                      checked={!!enabled[field.name]}
                      onChange={() => toggle(field.name)}
                      className="h-4 w-4 accent-gray-900"
                    />
                    {field.label}
                  </label>
                  {enabled[field.name] &&
                    (field.type === "textarea" ? (
                      <textarea
                        name={field.name}
                        placeholder={field.placeholder}
                        rows={2}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1"
                      />
                    ) : (
                      <input
                        name={field.name}
                        type={field.type}
                        placeholder={field.placeholder}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm flex-1"
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>

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
