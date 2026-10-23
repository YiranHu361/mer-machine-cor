import { useEffect } from "react";

/** Warn before a document change while an owner form has unsaved or pending work. */
export function useOwnerFormGuard(protectedWork: boolean) {
  useEffect(() => {
    if (!protectedWork) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [protectedWork]);
}
