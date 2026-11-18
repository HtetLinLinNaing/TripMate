"use client";
import { useEffect, useRef, type ReactNode } from "react";
/** Native modal keeps keyboard focus inside the warning and restores it when closed. */
export default function Confirmation({
  children,
  busy,
  onCancel,
}: {
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="overdraw-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {children}
    </dialog>
  );
}
