import Link from "next/link";

const quickActions = [
  {
    category: "홈 화면",
    title: "포스터 관리",
    description: "메인 화면에 사용할 포스터 이미지를 추가하고 교체합니다.",
    href: "/posters/manage",
    tone: "poster",
  },
  {
    category: "공지",
    title: "공지 등록",
    description: "학생들에게 전달할 새 공지를 작성해 바로 게시합니다.",
    href: "/notices/new",
    tone: "notice",
  },
  {
    category: "공지",
    title: "공지 수정·삭제",
    description: "등록한 공지의 제목과 내용을 바꾸거나 삭제합니다.",
    href: "/notices/manage",
    tone: "notice",
  },
  {
    category: "학생회 일정",
    title: "학생회 일정 관리",
    description: "등록된 일정을 확인하고 새로 등록하거나 수정·삭제합니다.",
    href: "/calendars/manage",
    tone: "calendar",
  },
  {
    category: "동아리",
    title: "동아리 등록",
    description: "새 동아리의 이름과 분과를 등록합니다.",
    href: "/clubs/new",
    tone: "club",
  },
  {
    category: "동아리",
    title: "동아리 조회·수정",
    description: "소개와 활동 내용, 대표·배경 사진을 관리합니다.",
    href: "/clubs/manage",
    tone: "club",
  },
  {
    category: "시간표",
    title: "전공 시간표 업로드",
    description: "전공 시간표 엑셀 파일을 확인하고 반영합니다.",
    href: "/courses/major",
    tone: "course",
  },
  {
    category: "시간표",
    title: "교양 시간표 업로드",
    description: "교양 시간표 엑셀 파일을 확인하고 반영합니다.",
    href: "/courses/general",
    tone: "course",
  },
];

export default function DashboardPage() {
  return (
    <div className="dashboard-stack modern-dashboard">
      <section className="dashboard-page-heading" aria-labelledby="quick-actions-title">
        <p className="section-label">한서메이트 학생회 관리</p>
        <h2 id="quick-actions-title">빠른 작업</h2>
        <p>관리할 업무를 선택하세요.</p>
      </section>

      <section className="quick-action-grid" aria-label="관리 업무 목록">
        {quickActions.map((action) => (
          <Link
            className={`quick-action-card ${action.tone}`}
            href={action.href}
            key={action.href}
          >
            <span className="quick-action-category">{action.category}</span>
            <h3>{action.title}</h3>
            <p>{action.description}</p>
            <span className="quick-action-arrow" aria-hidden="true">›</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
