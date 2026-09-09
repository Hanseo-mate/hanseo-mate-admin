"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ADMIN_LOGOUT_REQUEST_EVENT,
  clearAdminSession,
} from "../lib/auth";
import { ConfirmDialog } from "./ConfirmDialog";

type UnsavedChangesDialogProps = {
  dirty: boolean;
};

type PendingExit =
  | { kind: "navigate"; href: string }
  | { kind: "logout" }
  | null;

type TraverseNavigateEvent = Event & {
  navigationType: string;
  canIntercept: boolean;
  hashChange: boolean;
  destination: { sameDocument: boolean };
  intercept(options: { precommitHandler: () => Promise<void> }): void;
};

export function UnsavedChangesDialog({ dirty }: UnsavedChangesDialogProps) {
  const router = useRouter();
  const [pendingExit, setPendingExit] = useState<PendingExit>(null);

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
      setPendingExit({ kind: "navigate", href: next });
    }

    function protectLogout(event: Event) {
      event.preventDefault();
      setPendingExit({ kind: "logout" });
    }

    function warnBeforeLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const supportsPrecommit = "NavigationPrecommitController" in window;
    const protectHistoryTraversal: EventListener = (rawEvent) => {
      const event = rawEvent as TraverseNavigateEvent;
      if (
        event.navigationType !== "traverse" ||
        !event.destination.sameDocument ||
        !event.canIntercept ||
        !event.cancelable ||
        event.hashChange
      ) {
        return;
      }

      if (window.confirm("저장하지 않은 변경사항을 버리고 이동할까요?")) return;
      event.intercept({
        precommitHandler: async () => {
          throw new DOMException("Navigation cancelled", "AbortError");
        },
      });
    };

    document.addEventListener("click", protectInternalNavigation, true);
    window.addEventListener(ADMIN_LOGOUT_REQUEST_EVENT, protectLogout);
    window.addEventListener("beforeunload", warnBeforeLeave);
    if (navigation && supportsPrecommit) {
      navigation.addEventListener("navigate", protectHistoryTraversal);
    }
    return () => {
      document.removeEventListener("click", protectInternalNavigation, true);
      window.removeEventListener(ADMIN_LOGOUT_REQUEST_EVENT, protectLogout);
      window.removeEventListener("beforeunload", warnBeforeLeave);
      navigation?.removeEventListener("navigate", protectHistoryTraversal);
    };
  }, [dirty]);

  return (
    <ConfirmDialog
      open={Boolean(pendingExit)}
      title="저장하지 않은 변경사항이 있습니다."
      description="이 화면을 나가면 입력하거나 선택한 내용이 사라집니다."
      confirmLabel="변경사항 버리기"
      danger
      onCancel={() => setPendingExit(null)}
      onConfirm={() => {
        const action = pendingExit;
        setPendingExit(null);
        if (action?.kind === "navigate") router.push(action.href);
        if (action?.kind === "logout") clearAdminSession();
      }}
    />
  );
}
