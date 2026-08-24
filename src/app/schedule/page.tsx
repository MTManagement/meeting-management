const DUMMY_EVENTS = [
  { date: "2026-08-30", title: "8월 정기모임", attendees: "12/20 참석" },
  { date: "2026-09-06", title: "가을 등산 모임", attendees: "미응답" },
];

export default function SchedulePage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">일정</h1>
        <button className="rounded-md bg-gray-900 text-white text-sm px-3 py-2">
          + 일정 등록
        </button>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        예시 일정 목록입니다. 참석 여부 응답, 출석 체크 기능이 붙을 예정입니다.
      </p>
      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {DUMMY_EVENTS.map((event) => (
          <div key={event.title} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-sm">{event.title}</p>
              <p className="text-xs text-gray-400">{event.date}</p>
            </div>
            <span className="text-xs text-gray-500">{event.attendees}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
