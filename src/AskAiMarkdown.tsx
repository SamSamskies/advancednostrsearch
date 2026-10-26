import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeHttpUrl } from "./identity";

function hrefIfSafe(href: string | undefined): string | undefined {
  if (!href || !isSafeHttpUrl(href)) return undefined;
  return href;
}

export function AskAiMarkdown({ children }: { children: string }) {
  return (
    <div className="ask-ai-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(value) => (isSafeHttpUrl(value) ? value : "")}
        components={{
          a({ href, children }) {
            const safe = hrefIfSafe(href);
            if (!safe) return <>{children}</>;
            return (
              <a href={safe} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img() {
            return null;
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
