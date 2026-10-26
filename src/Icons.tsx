import type { SVGProps } from "react";

type IconName = "search" | "user" | "arrow" | "image" | "video";

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {name === "search" && (
        <>
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.5 4.5" />
        </>
      )}
      {name === "user" && (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
        </>
      )}
      {name === "arrow" && (
        <>
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </>
      )}
      {name === "image" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </>
      )}
      {name === "video" && (
        <>
          <rect x="3" y="5" width="13" height="14" rx="3" />
          <path d="m16 10 5-3v10l-5-3" />
        </>
      )}
    </svg>
  );
}

export function OstrichMark() {
  return (
    <svg
      className="ostrich-mark"
      viewBox="0 0 180 220"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M48 12c28-10 63 1 76 23 7 11 8 22 13 28l33 18c8 4 10 12 4 16l-41-4c-23-3-42 10-46 30-7 30 24 58 18 91H54c22-27 13-52 0-78-13-25-24-43-22-64L16 85c-2-15 6-30 18-41L7 55c7-18 23-29 41-32L21 22c14-14 35-15 53-9L48 12Z"
      />
      <ellipse cx="99" cy="62" rx="17" ry="18" fill="var(--sky)" />
      <circle cx="105" cy="57" r="5" fill="currentColor" />
      <path
        d="m124 82 39 5"
        stroke="var(--sky)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="m139 73 4 2"
        stroke="var(--sky)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
