import { describe, expect, it } from "vitest";
import { belongsToAnotherRole } from "../../src/app/routeAccess";

describe("pages of another role", () => {
  it("sends a student away from admin and support pages", () => {
    expect(belongsToAnotherRole("student", "/admin")).toBe(true);
    expect(belongsToAnotherRole("student", "/admin/days")).toBe(true);
    expect(belongsToAnotherRole("student", "/calendar")).toBe(true);
  });

  it("sends a support and the admin away from student pages", () => {
    expect(belongsToAnotherRole("support", "/book")).toBe(true);
    expect(belongsToAnotherRole("support", "/supports/42")).toBe(true);
    expect(belongsToAnotherRole("admin", "/history")).toBe(true);
  });

  it("keeps own, shared and unknown addresses", () => {
    expect(belongsToAnotherRole("student", "/history")).toBe(false);
    expect(belongsToAnotherRole("support", "/history")).toBe(false);
    expect(belongsToAnotherRole("student", "/rules")).toBe(false);
    expect(belongsToAnotherRole("support", "/calendar")).toBe(false);
    expect(belongsToAnotherRole("admin", "/admin/days")).toBe(false);
    expect(belongsToAnotherRole("manager", "/admin/bookings")).toBe(false);
    expect(belongsToAnotherRole("manager", "/admin/chats")).toBe(false);
    expect(belongsToAnotherRole("student", "/chat/42")).toBe(false);
    expect(belongsToAnotherRole("student", "/administrator")).toBe(false);
    expect(belongsToAnotherRole("student", "/no-such-page")).toBe(false);
  });
});
