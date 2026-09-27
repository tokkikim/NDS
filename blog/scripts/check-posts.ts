// 모든 글의 형식과 게시 조건을 검사합니다. 빌드 전에 자동으로 실행됩니다.
//   npm run check
import { todayString, topicForDate } from "../src/lib/dates";
import { getAllPostFiles, isPublished, parsePostFile, validatePost } from "../src/lib/posts";

const today = todayString();
const posts = getAllPostFiles().map(parsePostFile);
let failed = 0;

for (const post of posts) {
  const errors = validatePost(post);
  if (errors.length) {
    failed++;
    console.error(`✖ ${post.slug}.md`);
    for (const e of errors) console.error(`    - ${e}`);
  }
}

const published = posts.filter((p) => isPublished(p, today));
const scheduled = posts.filter((p) => !p.draft && p.date > today);
const drafts = posts.filter((p) => p.draft);

console.log(`글 ${posts.length}개: 게시 ${published.length} · 예약 ${scheduled.length} · 초안 ${drafts.length}`);
if (!posts.some((p) => p.date === today)) {
  console.log(`ℹ 오늘(${today}) 글이 아직 없습니다. 오늘의 주제: ${topicForDate(today).name}`);
}

if (failed) {
  console.error(`\n${failed}개 글에 문제가 있습니다. 초안은 draft: true로 두면 형식 검사만 합니다.`);
  process.exit(1);
}
console.log("✔ 모든 글이 검사를 통과했습니다.");
