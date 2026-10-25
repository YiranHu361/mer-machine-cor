/* Per-viewer conveniences only: the name on the profile and the list of orders
   this browser started. Everything that matters lives on the server. Every
   access is wrapped, because storage can be blocked or full. */

const PROFILE_KEY = "fabyn.consumer.profile";
const ORDERS_KEY = "fabyn.consumer.orders";

export interface Profile {
  name: string;
}

export const DEFAULT_PROFILE: Profile = { name: "Henry" };

export function readProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const v = JSON.parse(raw);
    return typeof v?.name === "string" && v.name.trim()
      ? { name: v.name.trim().slice(0, 40) }
      : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export interface OrderRef {
  id: string;
  title: string;
  at: string;
}

export function readOrderRefs(): OrderRef[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((x) => typeof x?.id === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

export function rememberOrder(ref: OrderRef) {
  try {
    const next = [ref, ...readOrderRefs().filter((r) => r.id !== ref.id)].slice(0, 50);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(next));
  } catch {
    /* my orders still works for this visit */
  }
}
