import { SITE } from "@/blog.config";
import { getVisibleTopics } from "@/lib/posts";
import { OG_SIZE, renderOgImage } from "@/lib/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = SITE.name;

export default function Image() {
  return renderOgImage({
    title: SITE.description,
    label: getVisibleTopics().map((t) => t.name).join(" · "),
    color: getVisibleTopics()[0]?.color ?? "#5b4df0",
  });
}
