import { useEffect, useState } from "react";

export function Avatar({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <span className="avatar avatar-empty" aria-hidden="true" />;
  }

  return (
    <img
      className="avatar"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
