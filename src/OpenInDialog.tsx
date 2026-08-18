import { useEffect, useId, useRef } from "react";
import {
  clientHref,
  clientsForPlatform,
  detectClientPlatform,
  isWebClientHref,
  type OpenInKind,
} from "./nostr-clients";

export type OpenInTarget = {
  kind: OpenInKind;
  code: string;
};

export function NoteMenuIcon() {
  return (
    <svg className="note-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.65" fill="currentColor" />
      <circle cx="12" cy="12" r="1.65" fill="currentColor" />
      <circle cx="18" cy="12" r="1.65" fill="currentColor" />
    </svg>
  );
}

export function OpenInDialog({
  target,
  onClose,
}: {
  target: OpenInTarget;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { kind, code } = target;
  const clients = clientsForPlatform(detectClientPlatform());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleClose = () => onCloseRef.current();
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  if (!code) return null;

  return (
    <dialog
      ref={dialogRef}
      className="open-in-dialog"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <h2 id={titleId} className="open-in-title">
        Open in
      </h2>
      <div className="open-in-list">
        {clients.map((client, index) => {
          const href = clientHref(client, code, kind);
          return (
            <a
              key={client.id}
              className={index === 0 ? "open-in-link primary" : "open-in-link secondary"}
              href={href}
              {...(isWebClientHref(href)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {client.name}
            </a>
          );
        })}
      </div>
      <button
        type="button"
        className="open-in-cancel"
        onClick={() => dialogRef.current?.close()}
      >
        Cancel
      </button>
    </dialog>
  );
}
