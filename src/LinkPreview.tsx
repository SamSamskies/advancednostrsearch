import { useEffect, useState } from "react";

export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  domain: string | null;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: LinkPreviewData }
  | { kind: "fallback" };

const previewCache = new Map<string, Promise<LinkPreviewData | null>>();

function loadPreview(url: string): Promise<LinkPreviewData | null> {
  const existing = previewCache.get(url);
  if (existing) return existing;

  const pending = fetch(`/api/preview?url=${encodeURIComponent(url)}`)
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<LinkPreviewData>;
      if (!data || typeof data !== "object") return null;
      const title = typeof data.title === "string" ? data.title : null;
      const description =
        typeof data.description === "string" ? data.description : null;
      const image = typeof data.image === "string" ? data.image : null;
      const domain = typeof data.domain === "string" ? data.domain : null;
      const finalUrl = typeof data.url === "string" ? data.url : url;
      if (!title && !description && !image) return null;
      return { url: finalUrl, title, description, image, domain };
    })
    .catch(() => null)
    .then((data) => {
      // Keep successful unfurls; drop misses/errors so a later remount can retry.
      if (!data && previewCache.get(url) === pending) {
        previewCache.delete(url);
      }
      return data;
    });

  previewCache.set(url, pending);
  return pending;
}

function ExternalIcon() {
  return (
    <svg
      className="note-link-preview-icon"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M3.5 2.5h2v1h-2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2h1v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm4.3 0H10v2.2L6.85 7.85l-.7-.7L8.6 3.5H7.8v-1Z"
      />
    </svg>
  );
}

export function LinkPreview({
  url,
  label,
}: {
  url: string;
  label: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    setImageFailed(false);

    loadPreview(url).then((data) => {
      if (cancelled) return;
      if (!data) setStatus({ kind: "fallback" });
      else setStatus({ kind: "ready", data });
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (status.kind === "fallback") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  if (status.kind === "loading") {
    return (
      <span className="note-link-preview note-link-preview-loading" aria-hidden>
        <span className="note-link-preview-thumb note-link-preview-thumb-empty" />
        <span className="note-link-preview-body">
          <span className="note-link-preview-skeleton note-link-preview-skeleton-sm" />
          <span className="note-link-preview-skeleton" />
          <span className="note-link-preview-skeleton note-link-preview-skeleton-md" />
        </span>
      </span>
    );
  }

  const { data } = status;
  const domain = data.domain || new URL(url).hostname;
  const showImage = Boolean(data.image) && !imageFailed;

  return (
    <a
      className="note-link-preview"
      href={data.url || url}
      target="_blank"
      rel="noreferrer"
    >
      {showImage ? (
        <img
          className="note-link-preview-thumb"
          src={data.image!}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="note-link-preview-thumb note-link-preview-thumb-empty" />
      )}
      <span className="note-link-preview-body">
        <span className="note-link-preview-domain">
          {domain}
          <ExternalIcon />
        </span>
        {data.title ? (
          <span className="note-link-preview-title">{data.title}</span>
        ) : null}
        {data.description ? (
          <span className="note-link-preview-description">
            {data.description}
          </span>
        ) : null}
      </span>
    </a>
  );
}
