"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type UnsavedChangesDialogProps = {
  dirty: boolean;
};

export function UnsavedChangesDialog({ dirty }: UnsavedChangesDialogProps) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;

    function protectInternalNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;

      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;

      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = `${destination.pathname}${destination.search}${destination.hash}`;
      if (current === next) return;

      event.preventDefault();
      setPendingHref(next);
    }

    document.addEventListener("click", protectInternalNavigation, true);
    return () => document.removeEventListener("click", protectInternalNavigation, true);
  }, [dirty]);

  return (
    <ConfirmDialog
      open={Boolean(pendingHref)}
      title="저장하지 않은 변경사항이 있습니다."
      description="이 화면을 나가면 입력하거나 선택한 내용이 사라집니다."
      confirmLabel="변경사항 버리기"
      danger
      onCancel={() => setPendingHref(null)}
      onConfirm={() => {
        const href = pendingHref;
        setPendingHref(null);
        if (href) router.push(href);
      }}
    />
  );
}
