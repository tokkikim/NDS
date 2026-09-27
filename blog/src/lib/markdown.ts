import { Marked } from "marked";

// 구글 정책상 제휴 링크에는 rel="sponsored"를 붙여야 합니다.
const AFFILIATE_HOSTS = ["link.coupang.com", "coupa.ng", "amzn.to", "click.linkprice.com"];

const marked = new Marked({
  gfm: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : "";
      if (!/^https?:\/\//.test(href)) return `<a href="${href}"${titleAttr}>${text}</a>`;

      const host = new URL(href).hostname;
      const rel = AFFILIATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
        ? "sponsored nofollow noopener"
        : "noopener";
      return `<a href="${href}"${titleAttr} target="_blank" rel="${rel}">${text}</a>`;
    },
    image({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<img src="${href}" alt="${text}"${titleAttr} loading="lazy" decoding="async">`;
    },
  },
});

/** 글 본문 마크다운을 HTML로 변환합니다. 본문은 운영자가 검토한 콘텐츠만 들어옵니다. */
export function renderMarkdown(content: string): string {
  // "이미지 제안" 같은 작성용 메모(HTML 주석)는 페이지에 내보내지 않습니다.
  return marked.parse(content.replace(/<!--[\s\S]*?-->/g, ""), { async: false });
}
