import { getTopic } from "@/blog.config";
import { addDays, todayString } from "@/lib/dates";
import type { Post } from "@/lib/posts";

const WEEKS = 20;

/** 최근 20주 동안 매일 공부 기록을 남겼는지 보여주는 달력 */
export function StudyCalendar({ posts }: { posts: Post[] }) {
  const today = todayString();
  const byDate = new Map(posts.map((p) => [p.date, p]));
  // 일요일부터 시작하도록 맞춥니다.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = addDays(today, -(WEEKS * 7 - 1) + (6 - weekday));

  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const date = addDays(start, i);
    const post = byDate.get(date);
    const color = post ? getTopic(post.topic)?.color : undefined;
    return (
      <i
        key={date}
        title={post ? `${date} · ${post.title}` : date}
        style={{
          background: color,
          visibility: date > today ? "hidden" : undefined,
        }}
      />
    );
  });

  return (
    <div className="calendar" aria-label="최근 공부 기록 달력">
      {cells}
    </div>
  );
}
