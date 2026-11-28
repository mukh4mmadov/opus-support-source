import type { Me } from "../lib/types";

const AREAS: Record<Me["role"], string[]> = {
  admin: ["/admin"],
  manager: ["/admin"],
  student: ["/book", "/supports", "/history", "/checkin"],
  support: ["/calendar", "/history", "/attendance", "/attend"],
};

const inArea = (areas: string[], pathname: string) =>
  areas.some((area) => pathname === area || pathname.startsWith(`${area}/`));

export function belongsToAnotherRole(role: Me["role"], pathname: string) {
  if (inArea(AREAS[role], pathname)) return false;
  return inArea(Object.values(AREAS).flat(), pathname);
}
