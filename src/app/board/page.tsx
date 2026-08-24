const DUMMY_POSTS = [
  { title: "8월 정기모임 공지", type: "공지", author: "총무" },
  { title: "이번 주 등산 어디로 갈까요?", type: "자유", author: "김철수" },
  { title: "다음 회식 메뉴 투표", type: "투표", author: "총무" },
];

export default function BoardPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">게시판</h1>
        <button className="rounded-md bg-gray-900 text-white text-sm px-3 py-2">
          + 게시판 만들기
        </button>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        예시 게시글 목록입니다. 게시판별로 참여방식/익명여부/용도(공지·자유·투표)
        옵션이 붙을 예정입니다.
      </p>
      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {DUMMY_POSTS.map((post) => (
          <div key={post.title} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-sm">{post.title}</p>
              <p className="text-xs text-gray-400">{post.author}</p>
            </div>
            <span className="rounded-full bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
              {post.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
