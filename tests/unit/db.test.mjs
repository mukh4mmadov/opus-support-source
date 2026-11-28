import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callAs, createDb } from "../../scripts/db.mjs";

let db;

const MONDAY = "2030-01-07T10:00:00+05:00";
const at = (date, time) => `${date}T${time}:00+05:00`;

const setNow = (iso) =>
  db.exec(`create or replace function public.app_now() returns timestamptz
    language sql stable as $f$ select '${iso}'::timestamptz $f$`);

async function user(role, first, last = "Test") {
  const { rows } = await db.query(
    "insert into auth.users (email) values ($1) returning id",
    [`${first}.${last}.${Math.random()}@opus.internal`.toLowerCase()],
  );
  const id = rows[0].id;
  await db.query(
    "insert into public.profiles (id, role, login, first_name, last_name) values ($1,$2,$3,$4,$5)",
    [id, role, `${first}${Math.random()}`, first, last],
  );
  return id;
}

async function workdays(support, start = "14:00", end = "18:00") {
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db.query(
      "insert into public.weekly_schedules (support_id, weekday, start_time, end_time) values ($1,$2,$3,$4)",
      [support, weekday, start, end],
    );
  }
}

const book = (student, support, startsAt, topic = "Past Simple") =>
  callAs(db, student, "book_lesson", {
    p_support: support,
    p_starts_at: startsAt,
    p_topic: topic,
  });

const rejects = (promise, code) => expect(promise).rejects.toThrow(code);

const setting = (key, value) =>
  db.query("update public.settings set value = $2::jsonb where key = $1", [
    key,
    JSON.stringify(value),
  ]);

const notificationsOf = async (id) =>
  (
    await db.query(
      "select type, title, body from public.notifications where user_id = $1",
      [id],
    )
  ).rows;

const statusOf = async (id) =>
  (
    await db.query(
      "select status, cancel_reason from public.bookings where id = $1",
      [id],
    )
  ).rows[0];

let admin, ozodbek, malika, aziza, bobur;

beforeAll(async () => {
  db = await createDb();
});

beforeEach(async () => {
  await db.exec(`truncate public.audit_log, public.notifications, public.bookings,
    public.penalties, public.bans, public.weekly_schedules, public.schedule_closures,
    public.reviews, public.messages, public.waitlist, public.favorite_supports cascade;
    delete from public.profiles; delete from auth.users;`);
  await setting("max_active_bookings", 1);
  await setting("topic_required", true);
  await setting("transfer_enabled", true);
  await setting("qr_checkin_enabled", false);
  await setting("close_min_days_before", 1);
  await setNow(MONDAY);
  admin = await user("admin", "Developer");
  ozodbek = await user("support", "Ozodbek");
  malika = await user("support", "Malika");
  aziza = await user("student", "Aziza", "Karimova");
  bobur = await user("student", "Bobur");
  await workdays(ozodbek);
  await workdays(malika);
});

describe("slots", () => {
  it("splits working hours into 30 minute lessons", async () => {
    const slots = await callAs(db, aziza, "support_slots", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(slots).toHaveLength(8);
    expect(new Date(slots[0].starts_at).toISOString()).toBe(
      "2030-01-08T09:00:00.000Z",
    );
    expect(new Date(slots[7].ends_at).toISOString()).toBe(
      "2030-01-08T13:00:00.000Z",
    );
  });

  it("has no slots on a day off", async () => {
    const slots = await callAs(db, aziza, "support_slots", {
      p_support: ozodbek,
      p_date: "2030-01-12",
    });
    expect(slots).toHaveLength(0);
  });

  it("follows the lesson length setting", async () => {
    await setting("lesson_minutes", 60);
    const slots = await callAs(db, aziza, "support_slots", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(slots).toHaveLength(4);
    await setting("lesson_minutes", 30);
  });
});

describe("booking screen", () => {
  it("lists the bookable week with free lessons per day", async () => {
    const days = await callAs(db, aziza, "booking_days");
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2030-01-08", free: 16 });
    expect(days.find((day) => day.date === "2030-01-12").free).toBe(0);
  });

  it("shows everyone working that day, with taken times marked but anonymous", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const day = await callAs(db, bobur, "day_availability", {
      p_date: "2030-01-08",
    });
    expect(day.map((support) => support.name)).toEqual([
      "Malika Test",
      "Ozodbek Test",
    ]);
    const taken = day[1].slots.filter((slot) => !slot.is_free);
    expect(taken).toHaveLength(1);
    expect(JSON.stringify(day)).not.toContain("Aziza");
  });

  it("leaves out supports with a closed day", async () => {
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    const day = await callAs(db, aziza, "day_availability", {
      p_date: "2030-01-08",
    });
    expect(day.map((support) => support.name)).toEqual(["Malika Test"]);
  });
});

describe("booking", () => {
  it("books a free slot and tells both sides", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    expect(b.status).toBe("booked");
    expect(b.topic).toBe("Past Simple");
    expect((await notificationsOf(aziza))[0].type).toBe("booking_confirmed");
    const [forSupport] = await notificationsOf(ozodbek);
    expect(forSupport.type).toBe("booking_new");
    expect(forSupport.body).toContain("Aziza Karimova");
    expect(forSupport.body).toContain("Past Simple");
  });

  it("never gives one slot to two students", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      book(bobur, ozodbek, at("2030-01-08", "14:00")),
      "SLOT_UNAVAILABLE",
    );
  });

  it("keeps a slot unique even when the checks are bypassed", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await expect(
      db.query(
        `insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at)
       select $1, support_id, lesson_date, starts_at, ends_at from public.bookings where id = $2`,
        [bobur, b.id],
      ),
    ).rejects.toThrow("bookings_slot_uq");
  });

  it("allows one active booking until attendance closes it", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      book(aziza, malika, at("2030-01-09", "15:00")),
      "ACTIVE_BOOKING_EXISTS",
    );
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    const next = await book(aziza, malika, at("2030-01-09", "15:00"));
    expect(next.status).toBe("booked");
  });

  it("allows only one lesson per day", async () => {
    await setting("max_active_bookings", 2);
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      book(aziza, malika, at("2030-01-08", "16:00")),
      "DAILY_LIMIT_REACHED",
    );
  });

  it("refuses today and anything past 7 days", async () => {
    await rejects(
      book(aziza, ozodbek, at("2030-01-07", "15:00")),
      "DATE_OUT_OF_RANGE",
    );
    await rejects(
      book(aziza, ozodbek, at("2030-01-15", "14:00")),
      "DATE_OUT_OF_RANGE",
    );
    expect((await book(aziza, ozodbek, at("2030-01-14", "14:00"))).status).toBe(
      "booked",
    );
  });

  it("refuses a time that is not a slot", async () => {
    await rejects(
      book(aziza, ozodbek, at("2030-01-08", "14:10")),
      "SLOT_UNAVAILABLE",
    );
    await rejects(
      book(aziza, ozodbek, at("2030-01-08", "19:00")),
      "SLOT_UNAVAILABLE",
    );
  });

  it("needs a topic", async () => {
    await rejects(
      book(aziza, ozodbek, at("2030-01-08", "14:00"), "   "),
      "TOPIC_REQUIRED",
    );
    await setting("topic_required", false);
    expect(
      (await book(aziza, ozodbek, at("2030-01-08", "14:00"), "")).status,
    ).toBe("booked");
  });

  it("does not let a support or a guest book", async () => {
    await rejects(
      book(ozodbek, malika, at("2030-01-08", "14:00")),
      "FORBIDDEN",
    );
    await rejects(
      book(null, malika, at("2030-01-08", "14:00")),
      "permission denied",
    );
  });

  it("lets the admin book for a banned student but not on a taken slot", async () => {
    await callAs(db, admin, "admin_add_ban", {
      p_student: aziza,
      p_hours: 24,
      p_reason: "test",
    });
    await book(bobur, ozodbek, at("2030-01-08", "14:00"));
    const args = { p_support: ozodbek, p_topic: "", p_student: aziza };
    await rejects(
      callAs(db, admin, "book_lesson", {
        ...args,
        p_starts_at: at("2030-01-08", "14:00"),
      }),
      "SLOT_UNAVAILABLE",
    );
    const b = await callAs(db, admin, "book_lesson", {
      ...args,
      p_starts_at: at("2030-01-08", "14:30"),
    });
    expect(b.student_id).toBe(aziza);
  });
});

describe("cancelling", () => {
  it("is free until the end of the day before", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await setNow(at("2030-01-08", "23:59"));
    const done = await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect(done.status).toBe("cancelled");
    expect(
      await callAs(db, aziza, "student_home").then((h) => h.active),
    ).toBeNull();
  });

  it("is refused on the lesson day", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await setNow(at("2030-01-09", "00:01"));
    await rejects(
      callAs(db, aziza, "cancel_booking", { p_booking: b.id }),
      "CANCEL_TOO_LATE",
    );
  });

  it("stays open to the admin on the lesson day", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await setNow(at("2030-01-09", "12:00"));
    const done = await callAs(db, admin, "cancel_booking", { p_booking: b.id });
    expect(done.status).toBe("cancelled");
  });

  it("opens booking again only the next day", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect((await callAs(db, aziza, "student_home")).rebook_from).toBe(
      "2030-01-08",
    );
    await rejects(
      book(aziza, malika, at("2030-01-09", "15:00")),
      "REBOOK_LATER",
    );

    await setNow(at("2030-01-08", "00:00"));
    expect((await callAs(db, aziza, "student_home")).rebook_from).toBeNull();
    expect((await book(aziza, malika, at("2030-01-09", "15:00"))).status).toBe(
      "booked",
    );
  });

  it("does not make a student wait for a lesson they did not give up", async () => {
    const closed = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, admin, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-09",
      p_reason: "Sick",
    });
    await callAs(db, aziza, "cancel_booking", { p_booking: closed.id });
    expect((await callAs(db, aziza, "student_home")).rebook_from).toBeNull();

    const byAdmin = await book(bobur, malika, at("2030-01-10", "14:00"));
    await callAs(db, admin, "cancel_booking", { p_booking: byAdmin.id });
    expect((await book(bobur, malika, at("2030-01-10", "15:00"))).status).toBe(
      "booked",
    );
  });

  it("lets the admin book during the wait, and the wait can be turned off", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    const made = await callAs(db, admin, "book_lesson", {
      p_support: malika,
      p_starts_at: at("2030-01-09", "15:00"),
      p_topic: "",
      p_student: aziza,
    });
    expect(made.status).toBe("booked");

    await setting("rebook_wait_days", 0);
    const second = await book(bobur, ozodbek, at("2030-01-10", "14:00"));
    await callAs(db, bobur, "cancel_booking", { p_booking: second.id });
    expect((await book(bobur, ozodbek, at("2030-01-10", "15:00"))).status).toBe(
      "booked",
    );
    await setting("rebook_wait_days", 1);
  });

  it("cannot touch another student's booking", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await rejects(
      callAs(db, bobur, "cancel_booking", { p_booking: b.id }),
      "FORBIDDEN",
    );
  });
});

describe("attendance and penalties", () => {
  const noShow = async (student, day) => {
    const b = await book(student, ozodbek, at(day, "14:00"));
    await setNow(at(day, "14:11"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });
    return b;
  };

  it("cannot mark before the lesson starts", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      callAs(db, ozodbek, "mark_attendance", {
        p_booking: b.id,
        p_status: "attended",
      }),
      "LESSON_NOT_STARTED",
    );
  });

  it("opens no-show only after 10 minutes", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:09"));
    await rejects(
      callAs(db, ozodbek, "mark_attendance", {
        p_booking: b.id,
        p_status: "no_show",
      }),
      "NO_SHOW_TOO_EARLY",
    );
    await setNow(at("2030-01-08", "14:10"));
    const done = await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });
    expect(done.status).toBe("no_show");
  });

  it("lets only the lesson support mark", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    const mark = (who) =>
      callAs(db, who, "mark_attendance", {
        p_booking: b.id,
        p_status: "attended",
      });
    await rejects(mark(malika), "FORBIDDEN");
    await rejects(mark(aziza), "FORBIDDEN");
    expect((await mark(ozodbek)).status).toBe("attended");
  });

  it("warns first, then bans for one day", async () => {
    await noShow(aziza, "2030-01-08");
    let home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(1);
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "warning"),
    ).toBe(true);

    await noShow(aziza, "2030-01-09");
    home = await callAs(db, aziza, "student_home");
    expect(new Date(home.ban.ends_at).toISOString()).toBe(
      new Date(at("2030-01-11", "00:00")).toISOString(),
    );
    await rejects(
      book(aziza, ozodbek, at("2030-01-11", "14:00")),
      "STUDENT_BANNED",
    );

    await setNow(at("2030-01-10", "23:50"));
    await rejects(
      book(aziza, ozodbek, at("2030-01-11", "14:00")),
      "STUDENT_BANNED",
    );
    await setNow(at("2030-01-11", "00:01"));
    expect((await book(aziza, ozodbek, at("2030-01-14", "14:00"))).status).toBe(
      "booked",
    );
  });

  it("forgets strikes after 30 days", async () => {
    await noShow(aziza, "2030-01-08");
    await setNow("2030-02-08T10:00:00+05:00");
    await noShow(aziza, "2030-02-11");
    const home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(1);
  });

  it("removes the ban when the admin corrects the mark", async () => {
    await noShow(aziza, "2030-01-08");
    const second = await noShow(aziza, "2030-01-09");
    await callAs(db, admin, "mark_attendance", {
      p_booking: second.id,
      p_status: "attended",
    });
    const home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(1);
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "ban_lifted"),
    ).toBe(true);
  });

  it("does not punish a student when the support was absent", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "15:00"));
    await callAs(db, admin, "mark_attendance", {
      p_booking: b.id,
      p_status: "support_absent",
    });
    const home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(0);
    expect(home.active).toBeNull();
  });

  it("frees an unmarked lesson at day end, with no penalty, and tells the admin", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-09", "00:05"));
    await db.query("select public.run_maintenance()");
    expect((await statusOf(b.id)).status).toBe("unmarked");
    const home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(0);
    expect(home.active).toBeNull();
    expect((await notificationsOf(admin))[0].type).toBe("unmarked_alert");
  });

  it("takes back a later ban when the no-show it rested on is corrected", async () => {
    const first = await noShow(aziza, "2030-01-08");
    await noShow(aziza, "2030-01-09");
    expect((await callAs(db, aziza, "student_home")).ban).not.toBeNull();
    await callAs(db, admin, "mark_attendance", {
      p_booking: first.id,
      p_status: "attended",
    });
    const home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(1);
  });

  it("leaves a ban the admin added by hand alone when strikes change", async () => {
    const first = await noShow(aziza, "2030-01-08");
    await callAs(db, admin, "admin_add_ban", {
      p_student: aziza,
      p_hours: 48,
      p_reason: "Rude",
    });
    await callAs(db, admin, "mark_attendance", {
      p_booking: first.id,
      p_status: "attended",
    });
    expect((await callAs(db, aziza, "student_home")).ban).not.toBeNull();
  });

  it("tells the student when the admin removes a penalty, and keeps the lesson as it was", async () => {
    const b = await noShow(aziza, "2030-01-08");
    const { rows } = await db.query(
      "select id from public.penalties where booking_id = $1",
      [b.id],
    );
    await callAs(db, admin, "admin_revoke_penalty", { p_penalty: rows[0].id });
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "warning_removed"),
    ).toBe(true);
    expect((await callAs(db, aziza, "student_home")).strikes).toBe(0);
    expect((await statusOf(b.id)).status).toBe("no_show");
  });
});

describe("closing a day", () => {
  it("offers another free support, then moves the lesson", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    expect(
      await callAs(db, ozodbek, "close_day", {
        p_support: ozodbek,
        p_date: "2030-01-08",
      }),
    ).toBe(1);
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
    expect(
      (await notificationsOf(aziza)).some(
        (n) => n.type === "day_closed_transfer",
      ),
    ).toBe(true);

    const home = await callAs(db, aziza, "student_home");
    expect(home.transfer_options.map((o) => o.support_id)).toEqual([malika]);

    const moved = await callAs(db, aziza, "accept_transfer", {
      p_booking: b.id,
      p_support: malika,
    });
    expect(moved.status).toBe("booked");
    expect(moved.support_id).toBe(malika);
    expect(
      (await notificationsOf(malika)).some((n) => n.type === "transfer_new"),
    ).toBe(true);
  });

  it("cancels without penalty when nobody else is free", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await book(bobur, malika, at("2030-01-08", "14:00"));
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(await statusOf(b.id)).toEqual({
      status: "cancelled",
      cancel_reason: "day_closed",
    });
    const home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(0);
    expect((await book(aziza, malika, at("2030-01-09", "14:00"))).status).toBe(
      "booked",
    );
  });

  it("reopens booking right after the student declines", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    await callAs(db, aziza, "decline_transfer", { p_booking: b.id });
    expect((await book(aziza, malika, at("2030-01-09", "14:00"))).status).toBe(
      "booked",
    );
  });

  it("cancels a transfer nobody answered once the lesson starts", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    await setNow(at("2030-01-08", "14:00"));
    await db.query("select public.run_maintenance()");
    expect(await statusOf(b.id)).toEqual({
      status: "cancelled",
      cancel_reason: "transfer_expired",
    });
  });

  it("refuses a transfer to a support who has just been taken", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    await book(bobur, malika, at("2030-01-08", "14:00"));
    await rejects(
      callAs(db, aziza, "accept_transfer", {
        p_booking: b.id,
        p_support: malika,
      }),
      "SLOT_UNAVAILABLE",
    );
  });

  it("needs a support to close at least one day before", async () => {
    const today = { p_support: ozodbek, p_date: "2030-01-07" };
    await rejects(callAs(db, ozodbek, "close_day", today), "CLOSE_TOO_LATE");
    await rejects(
      callAs(db, ozodbek, "close_day", {
        ...today,
        p_from: "15:00",
        p_to: "16:00",
      }),
      "CLOSE_TOO_LATE",
    );
    expect(
      await callAs(db, ozodbek, "close_day", {
        p_support: ozodbek,
        p_date: "2030-01-08",
      }),
    ).toBe(0);
  });

  it("lets the admin close the same day", async () => {
    expect(
      await callAs(db, admin, "close_day", {
        p_support: ozodbek,
        p_date: "2030-01-07",
      }),
    ).toBe(0);
  });

  it("closes only the chosen hours", async () => {
    const inside = await book(aziza, ozodbek, at("2030-01-08", "15:00"));
    const outside = await book(bobur, ozodbek, at("2030-01-08", "17:00"));
    const hit = await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
      p_from: "15:00",
      p_to: "16:00",
    });
    expect(hit).toBe(1);
    expect((await statusOf(inside.id)).status).toBe("needs_transfer");
    expect((await statusOf(outside.id)).status).toBe("booked");

    const slots = await callAs(db, bobur, "support_slots", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(slots).toHaveLength(8);
    expect(slots.filter((slot) => !slot.is_free)).toHaveLength(3);
  });

  it("refuses a transfer into closed hours", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "15:00"));
    await callAs(db, malika, "close_day", {
      p_support: malika,
      p_date: "2030-01-08",
      p_from: "15:00",
      p_to: "15:30",
    });
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(await statusOf(b.id)).toEqual({
      status: "cancelled",
      cancel_reason: "day_closed",
    });
  });

  it("refuses hours that end before they start", async () => {
    await rejects(
      callAs(db, ozodbek, "close_day", {
        p_support: ozodbek,
        p_date: "2030-01-08",
        p_from: "16:00",
        p_to: "15:00",
      }),
      "HOURS_INVALID",
    );
  });

  it("hides the closed day from students", async () => {
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    await rejects(
      book(aziza, ozodbek, at("2030-01-08", "14:00")),
      "SLOT_UNAVAILABLE",
    );
  });

  it("stops a support from closing a colleague or the whole center", async () => {
    await rejects(
      callAs(db, ozodbek, "close_day", {
        p_support: malika,
        p_date: "2030-01-08",
      }),
      "FORBIDDEN",
    );
    await rejects(
      callAs(db, ozodbek, "close_day", {
        p_support: null,
        p_date: "2030-01-08",
      }),
      "FORBIDDEN",
    );
  });

  it("cancels every lesson when the admin closes the center", async () => {
    const one = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const two = await book(bobur, malika, at("2030-01-08", "15:00"));
    await callAs(db, admin, "close_day", {
      p_support: null,
      p_date: "2030-01-08",
      p_reason: "Holiday",
    });
    expect((await statusOf(one.id)).status).toBe("cancelled");
    expect((await statusOf(two.id)).status).toBe("cancelled");
  });

  it("moves lessons that no longer fit a new schedule", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "17:00"));
    const hit = await callAs(db, admin, "admin_set_schedule", {
      p_support: ozodbek,
      p_rows: JSON.stringify([
        { weekday: 2, start_time: "14:00", end_time: "16:00" },
      ]),
    });
    expect(hit).toBe(1);
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
  });

  it("moves lessons when a support is deactivated", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, admin, "admin_update_user", {
      p_user: ozodbek,
      p_first: "Ozodbek",
      p_last: "Test",
      p_birth_year: null,
      p_bio: "",
      p_active: false,
    });
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
  });
});

describe("reminders", () => {
  const remindersOf = async (id) =>
    (await notificationsOf(id)).filter((n) => n.type.startsWith("reminder"));

  it("reminds both sides the evening before, once", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-07", "17:59"));
    await db.query("select public.run_maintenance()");
    expect(await remindersOf(aziza)).toHaveLength(0);
    await setNow(at("2030-01-07", "18:00"));
    await db.query("select public.run_maintenance()");
    await db.query("select public.run_maintenance()");
    expect(await remindersOf(aziza)).toHaveLength(1);
    expect((await remindersOf(ozodbek))[0].body).toContain("Aziza Karimova");
  });

  it("reminds an hour before the lesson", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "13:00"));
    await db.query("select public.run_maintenance()");
    expect((await remindersOf(aziza)).map((n) => n.title)).toContain(
      "Lesson soon",
    );
  });
});

describe("chat", () => {
  it("works between the two sides of an active booking only", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Hello teacher",
    });
    await rejects(
      callAs(db, bobur, "send_message", { p_booking: b.id, p_body: "hi" }),
      "FORBIDDEN",
    );
    await rejects(
      callAs(db, bobur, "chat_messages", { p_booking: b.id }),
      "FORBIDDEN",
    );
    const chat = await callAs(db, ozodbek, "chat_messages", {
      p_booking: b.id,
    });
    expect(chat.messages[0].body).toBe("Hello teacher");
    expect(
      (await notificationsOf(ozodbek)).some((n) => n.type === "chat_message"),
    ).toBe(true);
  });

  it("becomes read-only when the booking closes, and the admin can read it", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Hello",
    });
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    await rejects(
      callAs(db, aziza, "send_message", { p_booking: b.id, p_body: "x" }),
      "CHAT_CLOSED",
    );
    const chat = await callAs(db, admin, "chat_messages", { p_booking: b.id });
    expect(chat.can_send).toBe(true);
    expect(chat.messages).toHaveLength(1);
  });
});

describe("moving a lesson", () => {
  it("is no longer possible for a student", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      callAs(db, aziza, "reschedule_booking", {
        p_booking: b.id,
        p_support: malika,
        p_starts_at: at("2030-01-09", "15:00"),
      }),
      "reschedule_booking",
    );
  });
});

describe("marking deadline", () => {
  const lesson = at("2030-01-08", "14:00");
  const mark = (id, status, who = ozodbek, reason = "") =>
    callAs(db, who, "mark_attendance", {
      p_booking: id,
      p_status: status,
      p_reason: reason,
    });
  const maintain = () => db.query("select public.run_maintenance()");
  const typesOf = async (id) => (await notificationsOf(id)).map((n) => n.type);

  it("stays open until 10 minutes after the lesson ends", async () => {
    const b = await book(aziza, ozodbek, lesson);
    const second = await book(bobur, ozodbek, at("2030-01-08", "15:00"));
    await setNow(at("2030-01-08", "14:40"));
    expect((await mark(b.id, "attended")).status).toBe("attended");

    await setNow(at("2030-01-08", "15:41"));
    await rejects(mark(second.id, "attended"), "MARKING_CLOSED");
  });

  it("lets the support correct their own mark until the deadline, and the strike follows", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:12"));
    await mark(b.id, "no_show");
    expect((await callAs(db, aziza, "student_home")).strikes).toBe(1);
    await mark(b.id, "attended");
    expect((await callAs(db, aziza, "student_home")).strikes).toBe(0);

    await setNow(at("2030-01-08", "14:41"));
    await rejects(mark(b.id, "no_show"), "MARKING_CLOSED");
  });

  it("does not let a support overrule the admin", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:12"));
    await mark(b.id, "attended", admin);
    await rejects(mark(b.id, "no_show"), "ALREADY_MARKED");
  });

  it("warns both sides once, 15 minutes in, if the lesson is unmarked", async () => {
    await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:14"));
    await maintain();
    expect(await typesOf(ozodbek)).not.toContain("unmarked_support");

    await setNow(at("2030-01-08", "14:15"));
    await maintain();
    await maintain();
    expect(
      (await typesOf(ozodbek)).filter((type) => type === "unmarked_support"),
    ).toHaveLength(1);
    const notice = (await notificationsOf(aziza)).find(
      (n) => n.type === "unmarked_student",
    );
    expect(notice.body).toContain("14:40");
  });

  it("does not warn when the lesson is already marked", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:05"));
    await mark(b.id, "attended");
    await setNow(at("2030-01-08", "14:15"));
    await maintain();
    expect(await typesOf(aziza)).not.toContain("unmarked_student");
  });

  it("turns an unmarked lesson into a no-show at the deadline, with the penalty", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:39"));
    await maintain();
    expect((await statusOf(b.id)).status).toBe("booked");

    await setNow(at("2030-01-08", "14:40"));
    await maintain();
    expect((await statusOf(b.id)).status).toBe("no_show");
    const home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(1);
    expect(home.active).toBeNull();
    expect(await typesOf(ozodbek)).toContain("auto_no_show_support");
    const { rows } = await db.query(
      "select auto_marked, marked_by from public.bookings where id = $1",
      [b.id],
    );
    expect(rows[0]).toEqual({ auto_marked: true, marked_by: null });
    expect((await callAs(db, ozodbek, "my_attendance")).all.forgot).toBe(1);
  });

  it("bans on the second automatic no-show, and the admin can still undo it", async () => {
    const first = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:40"));
    await maintain();
    const second = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await setNow(at("2030-01-09", "14:40"));
    await maintain();
    expect((await callAs(db, aziza, "student_home")).ban).not.toBeNull();

    await mark(second.id, "support_absent", admin);
    await mark(first.id, "attended", admin);
    const home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(0);
    expect((await callAs(db, ozodbek, "my_attendance")).all.forgot).toBe(2);
    expect((await callAs(db, aziza, "my_history"))[0].auto_marked).toBe(false);
  });

  it("never punishes for lessons found late after the job was down", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "15:41"));
    await maintain();
    expect((await statusOf(b.id)).status).toBe("unmarked");
    expect((await callAs(db, aziza, "student_home")).strikes).toBe(0);
    expect(await typesOf(admin)).toContain("unmarked_alert");
  });

  it("can be turned off, and then the lesson waits for the day to end", async () => {
    await setting("auto_no_show_enabled", false);
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "20:00"));
    await maintain();
    expect((await statusOf(b.id)).status).toBe("booked");
    await setNow(at("2030-01-09", "00:01"));
    await maintain();
    expect((await statusOf(b.id)).status).toBe("unmarked");
    await setting("auto_no_show_enabled", true);
  });
});

describe("excused lessons", () => {
  const excuse = (id, who = ozodbek, reason = "Sick, told me by chat") =>
    callAs(db, who, "mark_attendance", {
      p_booking: id,
      p_status: "excused",
      p_reason: reason,
    });
  const excuseOn = async (date, nextBookingDay) => {
    await setNow(at(date, "09:00"));
    const [{ id }] = (
      await db.query(
        "select id from public.bookings where student_id = $1 and status = 'booked'",
        [aziza],
      )
    ).rows;
    await excuse(id);
    await setNow(at(nextBookingDay, "09:00"));
  };

  it("works from the morning of the lesson, with no penalty, and everyone can see it", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "09:00"));
    expect((await excuse(b.id)).status).toBe("excused");

    const home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(0);
    expect(home.active).toBeNull();
    const told = (await notificationsOf(aziza)).find(
      (n) => n.type === "lesson_excused",
    );
    expect(told.body).toContain("Sick, told me by chat");
    expect(told.body).toContain("1 of 2");
    expect(
      (await notificationsOf(admin)).some((n) => n.type === "excused_alert"),
    ).toBe(true);
    const log = await db.query(
      "select details from public.audit_log where action = 'booking.mark'",
    );
    expect(log.rows[0].details).toMatchObject({
      to: "excused",
      reason: "Sick, told me by chat",
    });
  });

  it("makes the student wait until the next day to book", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "09:00"));
    await excuse(b.id);
    await rejects(
      book(aziza, malika, at("2030-01-09", "15:00")),
      "REBOOK_LATER",
    );
    await setNow(at("2030-01-09", "00:00"));
    expect((await book(aziza, malika, at("2030-01-10", "15:00"))).status).toBe(
      "booked",
    );
  });

  it("needs a written reason, and only on the lesson day", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(excuse(b.id), "EXCUSE_NOT_TODAY");
    await setNow(at("2030-01-08", "09:00"));
    await rejects(excuse(b.id, ozodbek, "   "), "EXCUSE_REASON_REQUIRED");
  });

  it("cannot be given by the student, another support, or after the deadline", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "09:00"));
    await rejects(excuse(b.id, aziza), "FORBIDDEN");
    await rejects(excuse(b.id, malika), "FORBIDDEN");
    await setNow(at("2030-01-08", "14:41"));
    await rejects(excuse(b.id), "MARKING_CLOSED");
  });

  it("stops at the limit for a support, but not for the admin", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await excuseOn("2030-01-08", "2030-01-09");
    await book(aziza, ozodbek, at("2030-01-10", "14:00"));
    await excuseOn("2030-01-10", "2030-01-11");
    const third = await book(aziza, ozodbek, at("2030-01-14", "14:00"));
    await setNow(at("2030-01-14", "09:00"));
    await rejects(excuse(third.id), "EXCUSE_LIMIT_REACHED");
    expect((await excuse(third.id, admin, "")).status).toBe("excused");
  });

  it("is cleared with its wait when the admin corrects the mark", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "09:00"));
    await excuse(b.id);
    await callAs(db, admin, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    expect((await callAs(db, aziza, "student_home")).rebook_from).toBeNull();
    const { rows } = await db.query(
      "select excuse_reason from public.bookings where id = $1",
      [b.id],
    );
    expect(rows[0].excuse_reason).toBe("");
  });

  it("shows up per pair for the admin", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "09:00"));
    await excuse(b.id);
    const [pair] = await callAs(db, admin, "admin_pairs", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    expect(pair).toMatchObject({ excused: 1, forgot: 0, lessons: 0 });
  });
});

describe("QR check-in", () => {
  const lesson = at("2030-01-08", "14:00");
  const code = async (id, who = ozodbek) =>
    (await callAs(db, who, "checkin_code", { p_booking: id })).code;
  const checkIn = (id, value, who = aziza) =>
    callAs(db, who, "check_in", { p_booking: id, p_code: value });
  const started = async () => {
    await setting("qr_checkin_enabled", true);
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:05"));
    return b;
  };

  it("counts a lesson only when the student enters the code the support shows", async () => {
    const b = await started();
    await rejects(
      callAs(db, ozodbek, "mark_attendance", {
        p_booking: b.id,
        p_status: "attended",
      }),
      "QR_REQUIRED",
    );
    expect(await checkIn(b.id, await code(b.id))).toBe("ok");
    const { rows } = await db.query(
      "select status, checked_in_at, marked_by from public.bookings where id = $1",
      [b.id],
    );
    expect(rows[0].status).toBe("attended");
    expect(rows[0].checked_in_at).not.toBeNull();
    expect(rows[0].marked_by).toBe(aziza);
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "review_request"),
    ).toBe(false);
  });

  it("refuses an old code, a made-up code and another student", async () => {
    const b = await started();
    const first = await code(b.id);
    expect(await checkIn(b.id, first === "000000" ? "000001" : "000000")).toBe(
      "wrong",
    );
    await rejects(checkIn(b.id, first, bobur), "FORBIDDEN");

    await setNow(at("2030-01-08", "14:06"));
    expect(await checkIn(b.id, first)).toBe("wrong");
    expect((await statusOf(b.id)).status).toBe("booked");
  });

  it("accepts a code for 45 seconds, so a scan during a change still works", async () => {
    const b = await started();
    const first = await code(b.id);
    await setNow("2030-01-08T14:05:30+05:00");
    await code(b.id);
    expect(await checkIn(b.id, first)).toBe("ok");
  });

  it("does not exist before the lesson or after the deadline", async () => {
    await setting("qr_checkin_enabled", true);
    const b = await book(aziza, ozodbek, lesson);
    await rejects(code(b.id), "LESSON_NOT_STARTED");
    await setNow(at("2030-01-08", "14:41"));
    await rejects(code(b.id), "MARKING_CLOSED");
  });

  it("belongs to the support of this lesson", async () => {
    const b = await started();
    await rejects(code(b.id, malika), "FORBIDDEN");
    await rejects(code(b.id, aziza), "FORBIDDEN");
  });

  it("becomes a no-show at the deadline when nobody scans", async () => {
    const b = await started();
    await code(b.id);
    await setNow(at("2030-01-08", "14:40"));
    await db.query("select public.run_maintenance()");
    expect((await statusOf(b.id)).status).toBe("no_show");
    expect((await callAs(db, aziza, "student_home")).strikes).toBe(1);
  });

  it("lets a late student replace a no-show mark, and removes the strike", async () => {
    const b = await started();
    await setNow(at("2030-01-08", "14:11"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });
    let home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(1);
    expect(home.checkin_lesson.id).toBe(b.id);

    expect(await checkIn(b.id, await code(b.id))).toBe("ok");
    home = await callAs(db, aziza, "student_home");
    expect(home.strikes).toBe(0);
    expect(home.checkin_lesson).toBeNull();
  });

  it("drops the scanned mark when the admin changes the lesson", async () => {
    const b = await started();
    await checkIn(b.id, await code(b.id));
    await callAs(db, admin, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });
    const [row] = await callAs(db, aziza, "my_history");
    expect(row.checked_in_at).toBeNull();
  });

  it("cannot be undone by the support after a scan", async () => {
    const b = await started();
    await checkIn(b.id, await code(b.id));
    await setNow(at("2030-01-08", "14:12"));
    await rejects(
      callAs(db, ozodbek, "mark_attendance", {
        p_booking: b.id,
        p_status: "no_show",
      }),
      "ALREADY_MARKED",
    );
  });

  it("stops guessing after 20 wrong codes", async () => {
    const b = await started();
    const real = await code(b.id);
    const wrong = real === "000000" ? "000001" : "000000";
    for (let i = 0; i < 20; i += 1) await checkIn(b.id, wrong);
    await rejects(checkIn(b.id, real), "CHECKIN_LOCKED");
  });

  it("can be turned off, and then the support marks alone", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:05"));
    const done = await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    expect(done.status).toBe("attended");
    expect((await callAs(db, aziza, "student_home")).checkin_lesson).toBeNull();
  });
});

describe("closing today", () => {
  const lesson = at("2030-01-08", "15:00");
  const closeToday = (who = ozodbek, extra = {}) =>
    callAs(db, who, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
      p_reason: "Ill",
      ...extra,
    });

  beforeEach(async () => {
    await setting("close_min_days_before", 0);
  });

  it("works until the lesson starts, and the center is told", async () => {
    await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "14:59"));
    expect(await closeToday()).toBe(1);
    const notice = (await notificationsOf(admin)).find(
      (n) => n.type === "same_day_closure",
    );
    expect(notice.body).toContain("Ozodbek Test");
    expect(notice.body).toContain("Ill");
    expect(
      (await callAs(db, ozodbek, "my_attendance")).all.closed_same_day,
    ).toBe(1);
  });

  it("is refused once the lesson has started", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "15:00"));
    await rejects(closeToday(), "LESSON_ALREADY_STARTED");
    expect((await statusOf(b.id)).status).toBe("booked");
  });

  it("leaves other hours open while a lesson runs", async () => {
    await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "15:10"));
    expect(await closeToday(ozodbek, { p_from: "16:00", p_to: "18:00" })).toBe(
      0,
    );
  });

  it("cannot be wiped from the record by reopening the day", async () => {
    await setNow(at("2030-01-08", "10:00"));
    await closeToday();
    const { rows } = await db.query("select id from public.schedule_closures");
    await callAs(db, ozodbek, "reopen_day", { p_closure: rows[0].id });
    expect(
      (await callAs(db, ozodbek, "my_attendance")).all.closed_same_day,
    ).toBe(1);
    const [row] = (
      await callAs(db, admin, "admin_month_report", { p_month: "2030-01-01" })
    ).filter((item) => item.name.startsWith("Ozodbek"));
    expect(row.closed_same_day).toBe(1);
  });

  it("lets a support reopen only the time they closed themselves", async () => {
    const manager = await user("manager", "Reception");
    await callAs(db, manager, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-09",
      p_reason: "Leave",
    });
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-10",
      p_reason: "",
    });
    const { closures } = await callAs(db, ozodbek, "support_home");
    const byCenter = closures.find((c) => c.closed_on === "2030-01-09");
    const own = closures.find((c) => c.closed_on === "2030-01-10");
    expect(byCenter.can_reopen).toBe(false);
    expect(own.can_reopen).toBe(true);

    await rejects(
      callAs(db, ozodbek, "reopen_day", { p_closure: byCenter.id }),
      "CLOSED_BY_CENTER",
    );
    await rejects(
      callAs(db, malika, "reopen_day", { p_closure: own.id }),
      "FORBIDDEN",
    );
    await callAs(db, ozodbek, "reopen_day", { p_closure: own.id });
    await callAs(db, manager, "reopen_day", { p_closure: byCenter.id });
    expect((await callAs(db, ozodbek, "support_home")).closures).toEqual([]);
  });

  it("does not count closing a later day as closing on the day", async () => {
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-09",
      p_reason: "",
    });
    expect(
      (await callAs(db, ozodbek, "my_attendance")).all.closed_same_day,
    ).toBe(0);
  });

  it("opens the rest of today for the student who lost the lesson, and nobody else", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "10:00"));
    await setting("transfer_enabled", false);
    await closeToday();
    expect((await statusOf(b.id)).cancel_reason).toBe("day_closed");

    const home = await callAs(db, aziza, "student_home");
    expect(home.same_day_pass).toBe(true);
    expect(home.rebook_from).toBeNull();
    expect((await callAs(db, aziza, "booking_days"))[0].date).toBe(
      "2030-01-08",
    );
    expect((await callAs(db, bobur, "booking_days"))[0].date).toBe(
      "2030-01-09",
    );

    expect((await book(aziza, malika, at("2030-01-08", "16:00"))).status).toBe(
      "booked",
    );
    await rejects(
      book(bobur, malika, at("2030-01-08", "17:00")),
      "DATE_OUT_OF_RANGE",
    );
  });

  it("also opens today when the student turns down the other support", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "10:00"));
    await closeToday();
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
    await callAs(db, aziza, "decline_transfer", { p_booking: b.id });
    expect((await book(aziza, malika, at("2030-01-08", "16:00"))).status).toBe(
      "booked",
    );
  });

  it("also opens today when the admin cancels the lesson", async () => {
    const b = await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "10:00"));
    await callAs(db, admin, "cancel_booking", { p_booking: b.id });
    expect((await callAs(db, aziza, "student_home")).same_day_pass).toBe(true);
  });

  it("ends the same-day right once the student has a new lesson", async () => {
    await book(aziza, ozodbek, lesson);
    await setNow(at("2030-01-08", "10:00"));
    await setting("transfer_enabled", false);
    await closeToday();
    await book(aziza, malika, at("2030-01-08", "16:00"));
    expect((await callAs(db, aziza, "student_home")).same_day_pass).toBe(false);
    expect((await callAs(db, aziza, "booking_days"))[0].date).toBe(
      "2030-01-09",
    );
  });

  it("gives no such right to a student who cancelled by choice", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "15:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect((await callAs(db, aziza, "student_home")).same_day_pass).toBe(false);
  });
});

describe("complaints", () => {
  it("reaches the admin, not the support, and the answer comes back", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "15:00"));
    await db.query("select public.run_maintenance()");
    await callAs(db, aziza, "send_complaint", {
      p_booking: b.id,
      p_body: "I came, but it says missed",
    });
    expect(
      (await notificationsOf(admin)).some((n) => n.type === "complaint_new"),
    ).toBe(true);
    expect(
      (await notificationsOf(ozodbek)).some((n) => n.type === "complaint_new"),
    ).toBe(false);

    const [own] = await callAs(db, aziza, "my_history");
    expect(own.complaint.body).toContain("I came");
    const [theirs] = await callAs(db, ozodbek, "my_history");
    expect(theirs.complaint).toBeNull();

    const [item] = await callAs(db, admin, "admin_complaints");
    expect(item.booking.student_name).toContain("Aziza");
    await callAs(db, admin, "admin_answer_complaint", {
      p_complaint: item.id,
      p_reply: "Fixed it",
    });
    expect(
      (await notificationsOf(aziza)).find(
        (n) => n.type === "complaint_answered",
      ).body,
    ).toContain("Fixed it");
    expect((await callAs(db, aziza, "my_history"))[0].complaint.reply).toBe(
      "Fixed it",
    );
  });

  it("shows the student when the center has seen and answered it", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "15:00"));
    await db.query("select public.run_maintenance()");
    await callAs(db, aziza, "send_complaint", {
      p_booking: b.id,
      p_body: "Problem",
    });
    let [own] = await callAs(db, aziza, "my_history");
    expect(own.complaint.created_at).toBeTruthy();
    expect(own.complaint.seen_at).toBeNull();

    const board = await callAs(db, admin, "admin_dashboard");
    expect(board.complaints[0].student_name).toContain("Aziza");
    expect(board.complaints[0].seen_at).toBeNull();
    expect(board.mark_after_minutes).toBeGreaterThan(0);
    await rejects(callAs(db, aziza, "admin_complaints_seen"), "FORBIDDEN");
    await callAs(db, admin, "admin_complaints_seen");
    [own] = await callAs(db, aziza, "my_history");
    expect(own.complaint.seen_at).toBeTruthy();
    expect(own.complaint.answered_at).toBeNull();

    const [item] = await callAs(db, admin, "admin_complaints");
    await callAs(db, admin, "admin_answer_complaint", {
      p_complaint: item.id,
      p_reply: "Done",
    });
    [own] = await callAs(db, aziza, "my_history");
    expect(own.complaint.answered_at).toBeTruthy();
    expect((await callAs(db, admin, "admin_dashboard")).complaints).toEqual([]);
  });

  it("needs words, one per lesson, and only about your own lesson", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "15:00"));
    await db.query("select public.run_maintenance()");
    await rejects(
      callAs(db, aziza, "send_complaint", { p_booking: b.id, p_body: "  " }),
      "COMPLAINT_EMPTY",
    );
    await rejects(
      callAs(db, bobur, "send_complaint", { p_booking: b.id, p_body: "x" }),
      "FORBIDDEN",
    );
    await callAs(db, aziza, "send_complaint", { p_booking: b.id, p_body: "x" });
    await rejects(
      callAs(db, aziza, "send_complaint", { p_booking: b.id, p_body: "y" }),
      "COMPLAINT_EXISTS",
    );
    expect((await callAs(db, aziza, "my_history"))[0].can_complain).toBe(false);
  });

  it("opens once the lesson is no longer upcoming and closes at midnight of the lesson day", async () => {
    const send = (b) =>
      callAs(db, aziza, "send_complaint", { p_booking: b.id, p_body: "x" });
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(send(b), "COMPLAINT_NOT_YET");
    expect((await callAs(db, aziza, "my_history"))[0].can_complain).toBe(false);

    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    await setNow(at("2030-01-08", "23:59"));
    const [row] = await callAs(db, aziza, "my_history");
    expect(row.can_complain).toBe(true);
    expect(new Date(row.complaint_until).toISOString()).toBe(
      "2030-01-08T19:00:00.000Z",
    );
    expect((await callAs(db, ozodbek, "my_history"))[0].can_complain).toBe(false);

    await setNow(at("2030-01-09", "00:00"));
    await rejects(send(b), "COMPLAINT_CLOSED");
    expect((await callAs(db, aziza, "my_history"))[0].can_complain).toBe(false);
  });

  it("stays open longer when the setting allows more days", async () => {
    await setting("complaint_days", 2);
    try {
      const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
      await setNow(at("2030-01-10", "23:00"));
      await db.query("select public.run_maintenance()");
      await callAs(db, aziza, "send_complaint", { p_booking: b.id, p_body: "x" });
      expect((await callAs(db, aziza, "my_history"))[0].complaint.body).toBe("x");
    } finally {
      await setting("complaint_days", 0);
    }
  });
});

describe("transfer offers", () => {
  it("cannot be accepted once the lesson has started", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, admin, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
    await setNow(at("2030-01-08", "14:01"));
    await rejects(
      callAs(db, aziza, "accept_transfer", {
        p_booking: b.id,
        p_support: malika,
      }),
      "BOOKING_NOT_ACTIVE",
    );
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
  });
});

describe("ranking", () => {
  const attended = (student, date, count = 1) =>
    db.query(
      `
    insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at, status)
    select $1, $2, $3::date, s, s + interval '30 minutes', 'attended'
    from generate_series($3::date + time '08:00', $3::date + time '08:00' + ($4::int - 1) * interval '30 minutes', interval '30 minutes') s
  `,
      [student, ozodbek, date, count],
    );

  it("ranks the center by attended lessons, for the month and for all time", async () => {
    await attended(aziza, "2030-01-02", 3);
    await attended(bobur, "2030-01-03", 1);
    await attended(bobur, "2029-12-03", 5);

    const month = await callAs(db, bobur, "leaderboard", { p_period: "month" });
    expect(month.top.map((row) => [row.place, row.lessons])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(month.top[1].is_me).toBe(true);
    expect(month.me).toEqual({ place: 2, lessons: 1 });

    const all = await callAs(db, ozodbek, "leaderboard", { p_period: "all" });
    expect(all.top[0]).toMatchObject({ place: 1, lessons: 6 });
    expect(all.me).toBeNull();
  });

  it("shares a place on a tie, leaves out archived students, and can be turned off", async () => {
    await attended(aziza, "2030-01-02", 2);
    await attended(bobur, "2030-01-03", 2);
    let { top } = await callAs(db, aziza, "leaderboard", { p_period: "month" });
    expect(top.map((row) => row.place)).toEqual([1, 1]);

    await callAs(db, admin, "admin_set_archived", {
      p_user: bobur,
      p_archived: true,
    });
    top = (await callAs(db, aziza, "leaderboard", { p_period: "month" })).top;
    expect(top).toHaveLength(1);

    await setting("leaderboard_enabled", false);
    await rejects(
      callAs(db, aziza, "leaderboard", { p_period: "month" }),
      "LEADERBOARD_DISABLED",
    );
    await setting("leaderboard_enabled", true);
  });
});

describe("admin control of the new rules", () => {
  it("opens booking early for a student who has to wait", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect(
      (await callAs(db, admin, "admin_user_extras", { p_user: aziza }))
        .rebook_from,
    ).toBe("2030-01-08");
    await callAs(db, admin, "admin_clear_rebook", { p_student: aziza });
    expect((await book(aziza, malika, at("2030-01-09", "15:00"))).status).toBe(
      "booked",
    );
  });

  it("hides someone from the ranking", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    await callAs(db, admin, "admin_set_ranking_hidden", {
      p_user: aziza,
      p_hidden: true,
    });
    expect(
      (await callAs(db, bobur, "leaderboard", { p_period: "all" })).top,
    ).toHaveLength(0);
    await callAs(db, admin, "admin_set_ranking_hidden", {
      p_user: aziza,
      p_hidden: false,
    });
    expect(
      (await callAs(db, bobur, "leaderboard", { p_period: "all" })).top,
    ).toHaveLength(1);
  });

  it("sees who has notifications, deletes complaints, and downloads them", async () => {
    await db.query(
      `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values ($1, 'https://push.example/1', 'key', 'auth')`,
      [aziza],
    );
    const people = await callAs(db, admin, "admin_list_users", {
      p_role: "student",
    });
    expect(people.find((p) => p.id === aziza).push_devices).toBe(1);
    expect(people.find((p) => p.id === bobur).push_devices).toBe(0);

    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "15:00"));
    await db.query("select public.run_maintenance()");
    await callAs(db, aziza, "send_complaint", {
      p_booking: b.id,
      p_body: "Problem",
    });
    const lists = await callAs(db, admin, "admin_export");
    expect(lists.Complaints[0].complaint).toBe("Problem");
    expect(Object.keys(lists.Lessons[0])).toContain("qr_scanned_at");
    expect((await callAs(db, admin, "admin_dashboard")).open_complaints).toBe(
      1,
    );

    const [item] = await callAs(db, admin, "admin_complaints");
    await callAs(db, admin, "admin_delete_complaint", { p_complaint: item.id });
    expect(await callAs(db, admin, "admin_complaints")).toHaveLength(0);
  });

  it("resets the unmarked warning when a lesson is moved", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:15"));
    await db.query("select public.run_maintenance()");
    await callAs(db, admin, "admin_move_booking", {
      p_booking: b.id,
      p_support: malika,
      p_starts_at: at("2030-01-08", "16:00"),
    });
    const { rows } = await db.query(
      "select reminded_unmarked_at from public.bookings where id = $1",
      [b.id],
    );
    expect(rows[0].reminded_unmarked_at).toBeNull();
  });
});

describe("charts", () => {
  it("gives the last 12 weeks and months with each kind of lesson", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:12"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });

    const weeks = await callAs(db, aziza, "my_attendance_series", {
      p_unit: "week",
    });
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)).toMatchObject({
      start: "2030-01-07",
      no_show: 1,
      attended: 0,
    });
    const months = await callAs(db, admin, "admin_attendance_series", {
      p_user: aziza,
      p_unit: "month",
    });
    expect(months.at(-1)).toMatchObject({ start: "2030-01-01", no_show: 1 });
    await rejects(
      callAs(db, aziza, "my_attendance_series", { p_unit: "decade" }),
      "INVALID_PERIOD",
    );
  });
});

describe("moving a lesson", () => {
  const iso = (value) => new Date(value).toISOString();
  const move = (who, booking, support, startsAt, topic) =>
    callAs(db, who, "move_booking", {
      p_booking: booking,
      p_support: support,
      p_starts_at: startsAt,
      ...(topic ? { p_topic: topic } : {}),
    });

  it("moves to another free time and support, with no wait, and frees the old time", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    const moved = await move(
      aziza,
      b.id,
      malika,
      at("2030-01-10", "15:00"),
      "Speaking",
    );
    expect(moved).toMatchObject({
      id: b.id,
      support_id: malika,
      status: "booked",
      topic: "Speaking",
    });
    expect(iso(moved.starts_at)).toBe(iso(at("2030-01-10", "15:00")));
    expect(iso(moved.ends_at)).toBe(iso(at("2030-01-10", "15:30")));

    const home = await callAs(db, aziza, "student_home");
    expect(home.rebook_from).toBeNull();
    expect(home.moves_left).toBe(1);
    expect(home.rules.moves_per_month).toBe(2);
    expect(
      (await notificationsOf(ozodbek)).some(
        (n) => n.type === "booking_cancelled",
      ),
    ).toBe(true);
    expect(
      (await notificationsOf(malika)).some((n) => n.type === "booking_new"),
    ).toBe(true);
    await book(bobur, ozodbek, at("2030-01-09", "14:00"));
  });

  it("allows two time changes a calendar month, and opens them again next month", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await move(aziza, b.id, ozodbek, at("2030-01-09", "14:30"));
    await move(aziza, b.id, ozodbek, at("2030-01-09", "15:00"));
    await rejects(
      move(aziza, b.id, ozodbek, at("2030-01-09", "15:30")),
      "MOVE_LIMIT",
    );
    expect((await callAs(db, aziza, "student_home")).moves_left).toBe(0);
    await setNow(at("2030-02-01", "09:00"));
    expect((await callAs(db, aziza, "student_home")).moves_left).toBe(2);
  });

  it("works only for your own booked lesson, until the end of the day before it", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await rejects(
      move(bobur, b.id, ozodbek, at("2030-01-10", "14:00")),
      "FORBIDDEN",
    );
    await rejects(
      move(aziza, b.id, ozodbek, at("2030-01-20", "14:00")),
      "DATE_OUT_OF_RANGE",
    );
    await rejects(
      move(aziza, b.id, ozodbek, at("2030-01-09", "14:00")),
      "SLOT_UNAVAILABLE",
    );
    await book(bobur, malika, at("2030-01-10", "14:00"));
    await rejects(
      move(aziza, b.id, malika, at("2030-01-10", "14:00")),
      "SLOT_UNAVAILABLE",
    );
    expect((await statusOf(b.id)).status).toBe("booked");

    await setNow(at("2030-01-09", "09:00"));
    await rejects(
      move(aziza, b.id, ozodbek, at("2030-01-10", "14:00")),
      "MOVE_TOO_LATE",
    );
    expect((await callAs(db, aziza, "student_home")).moves_left).toBe(2);

    await setNow(MONDAY);
    await setting("moves_per_month", 0);
    await rejects(
      move(aziza, b.id, ozodbek, at("2030-01-10", "14:00")),
      "MOVE_LIMIT",
    );
    await setting("moves_per_month", 2);
  });
});

describe("before a closure or new hours", () => {
  it("lists the booked lessons they would touch, and changes nothing", async () => {
    const one = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    const two = await book(bobur, ozodbek, at("2030-01-09", "17:00"));
    const day = await callAs(db, ozodbek, "closure_preview", {
      p_support: ozodbek,
      p_date: "2030-01-09",
    });
    expect(day.map((lesson) => [lesson.id, lesson.outcome])).toEqual([
      [one.id, "transfer"],
      [two.id, "transfer"],
    ]);
    expect(day[0].student_name).toBe("Aziza Karimova");

    const hours = await callAs(db, ozodbek, "closure_preview", {
      p_support: ozodbek,
      p_date: "2030-01-09",
      p_from: "16:30",
      p_to: "18:00",
    });
    expect(hours.map((lesson) => lesson.id)).toEqual([two.id]);
    const center = await callAs(db, admin, "closure_preview", {
      p_support: null,
      p_date: "2030-01-09",
    });
    expect(center.map((lesson) => lesson.outcome)).toEqual([
      "cancel",
      "cancel",
    ]);
    await rejects(
      callAs(db, malika, "closure_preview", {
        p_support: ozodbek,
        p_date: "2030-01-09",
      }),
      "FORBIDDEN",
    );

    const rows = [{ weekday: 3, start_time: "14:00", end_time: "16:00" }];
    const schedule = await callAs(db, admin, "admin_schedule_preview", {
      p_support: ozodbek,
      p_rows: rows,
    });
    expect(schedule.map((lesson) => lesson.id)).toEqual([two.id]);
    await rejects(
      callAs(db, ozodbek, "admin_schedule_preview", {
        p_support: ozodbek,
        p_rows: rows,
      }),
      "FORBIDDEN",
    );

    expect((await statusOf(one.id)).status).toBe("booked");
    expect((await statusOf(two.id)).status).toBe("booked");
  });

  it("shows the admin how full each support teacher is, day by day", async () => {
    await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    const week = await callAs(db, admin, "admin_workload", {
      p_week_start: "2030-01-09",
    });
    expect(week.week_start).toBe("2030-01-07");
    const row = week.supports.find((support) =>
      support.name.startsWith("Ozodbek"),
    );
    expect(row.days).toHaveLength(7);
    expect(row.days[2]).toMatchObject({
      date: "2030-01-09",
      booked: 1,
      sessions: 8,
    });
    expect(row.days[5]).toMatchObject({ booked: 0, sessions: 0 });
    await rejects(
      callAs(db, aziza, "admin_workload", { p_week_start: "2030-01-07" }),
      "FORBIDDEN",
    );
  });
});

describe("second-level admin", () => {
  let desk;
  beforeEach(async () => {
    desk = await user("manager", "Second");
  });

  it("sets hours and closed days, reads bookings, statistics, reviews and complaints, and answers them", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const list = await callAs(db, desk, "admin_bookings", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    expect(list.map((x) => x.id)).toEqual([b.id]);
    await callAs(db, desk, "admin_stats", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    await callAs(db, desk, "admin_month_report", { p_month: "2030-01-01" });
    await callAs(db, desk, "admin_reviews");
    await callAs(db, desk, "admin_set_schedule", {
      p_support: malika,
      p_rows: [{ weekday: 3, start_time: "14:00", end_time: "18:00" }],
    });
    await callAs(db, desk, "close_day", {
      p_support: malika,
      p_date: "2030-01-09",
    });

    await setNow(at("2030-01-08", "15:00"));
    await db.query("select public.run_maintenance()");
    await callAs(db, aziza, "send_complaint", {
      p_booking: b.id,
      p_body: "Problem",
    });
    expect(
      (await notificationsOf(desk)).some((n) => n.type === "complaint_new"),
    ).toBe(true);
    const [complaint] = await callAs(db, desk, "admin_complaints");
    await callAs(db, desk, "admin_answer_complaint", {
      p_complaint: complaint.id,
      p_reply: "We will check",
    });

    const exported = await callAs(db, desk, "admin_export");
    expect(Object.keys(exported)).toEqual(expect.arrayContaining(["People", "Lessons", "Reviews", "Complaints"]));
    for (const list of ["Chats", "Activity log", "Strikes", "Bans"]) {
      expect(Object.keys(exported)).not.toContain(list);
    }
    const listed = await callAs(db, desk, "admin_list_users", { p_search: "" });
    expect(listed.map((person) => person.id)).not.toContain(admin);
    expect(listed.some((person) => person.role === "manager")).toBe(false);
  });

  it("cannot change the About text, but edits the rest and makes a person inactive", async () => {
    await db.query("update public.profiles set bio = 'IELTS 8' where id = $1", [
      ozodbek,
    ]);
    await callAs(db, desk, "admin_update_user", {
      p_user: ozodbek,
      p_first: "Ozodbek",
      p_last: "Test",
      p_birth_year: null,
      p_bio: "changed",
      p_active: true,
      p_phone: "+998 90 000 00 00",
    });
    const { rows } = await db.query(
      "select bio, phone from public.profiles where id = $1",
      [ozodbek],
    );
    expect(rows[0]).toEqual({ bio: "IELTS 8", phone: "+998 90 000 00 00" });
    const detail = await callAs(db, desk, "admin_user_detail", {
      p_user: ozodbek,
    });
    expect(detail.profile).not.toHaveProperty("bio");
    expect(detail.chats).toEqual([]);
    expect(detail.bans).toEqual([]);
    expect(detail.penalties).toEqual([]);
    await callAs(db, desk, "admin_set_archived", {
      p_user: bobur,
      p_archived: true,
    });
    expect(
      (await callAs(db, admin, "admin_user_detail", { p_user: bobur })).profile
        .archived_at,
    ).toBeTruthy();
  });

  it("hears about same-day closures and lessons left unmarked", async () => {
    await setting("close_min_days_before", 0);
    await setNow(at("2030-01-08", "09:00"));
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect(
      (await notificationsOf(desk)).some((n) => n.type === "same_day_closure"),
    ).toBe(true);
    await setting("close_min_days_before", 1);

    await setting("auto_no_show_enabled", false);
    await setNow(MONDAY);
    await book(aziza, malika, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-09", "10:00"));
    await db.query("select public.run_maintenance()");
    expect(
      (await notificationsOf(desk)).some((n) => n.type === "unmarked_alert"),
    ).toBe(true);
    expect(
      (await notificationsOf(admin)).some((n) => n.type === "unmarked_alert"),
    ).toBe(true);
    await setting("auto_no_show_enabled", true);

    const excused = await book(aziza, malika, at("2030-01-10", "14:00"));
    await setNow(at("2030-01-10", "14:05"));
    await callAs(db, malika, "mark_attendance", {
      p_booking: excused.id,
      p_status: "excused",
      p_reason: "Ill",
    });
    expect(
      (await notificationsOf(desk)).some((n) => n.type === "excused_alert"),
    ).toBe(true);
    expect(
      (await notificationsOf(admin)).some((n) => n.type === "excused_alert"),
    ).toBe(true);
  });

  it("cannot change lessons, punish, message, change reviews or the ranking, or touch the developer", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    for (const [name, args] of [
      ["admin_add_ban", { p_student: aziza, p_hours: 24, p_reason: "x" }],
      ["admin_add_warning", { p_student: aziza, p_note: "x" }],
      [
        "admin_send_notice",
        { p_audience: "all", p_user: null, p_title: "x", p_body: "x" },
      ],
      ["admin_delete_booking", { p_booking: b.id }],
      ["admin_set_ranking_hidden", { p_user: aziza, p_hidden: true }],
      ["admin_set_review_hidden", { p_review: b.id, p_hidden: true }],
      ["admin_delete_complaint", { p_complaint: b.id }],
      ["admin_config", {}],
      ["admin_user_detail", { p_user: admin }],
      ["admin_set_archived", { p_user: admin, p_archived: true }],
    ]) {
      await rejects(callAs(db, desk, name, args), "FORBIDDEN");
    }
    await rejects(
      callAs(db, desk, "book_lesson", {
        p_support: malika,
        p_starts_at: at("2030-01-10", "14:00"),
        p_topic: "x",
        p_student: bobur,
      }),
      "FORBIDDEN",
    );
    await setNow(at("2030-01-09", "14:20"));
    await rejects(
      callAs(db, desk, "mark_attendance", {
        p_booking: b.id,
        p_status: "attended",
      }),
      "FORBIDDEN",
    );
    await rejects(
      callAs(db, desk, "cancel_booking", { p_booking: b.id }),
      "FORBIDDEN",
    );
    expect((await statusOf(b.id)).status).toBe("booked");
  });

  it("cannot open a student's booking early, that stays with the developer", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    await rejects(
      callAs(db, desk, "admin_clear_rebook", { p_student: aziza }),
      "FORBIDDEN",
    );
    const { rows } = await db.query(
      "select rebook_from from public.bookings where student_id = $1",
      [aziza],
    );
    expect(rows[0].rebook_from).not.toBeNull();
  });

  it("cannot change support hours when that would move or cancel a booking", async () => {
    await book(aziza, malika, at("2030-01-08", "14:00"));
    await rejects(
      callAs(db, desk, "admin_set_schedule", {
        p_support: malika,
        p_rows: [{ weekday: 3, start_time: "14:00", end_time: "18:00" }],
      }),
      "BOOKINGS_AFFECTED_OWNER_ONLY",
    );
    const schedule = await callAs(db, desk, "admin_list_users", {
      p_role: "support",
      p_search: "Malika",
    });
    expect(schedule[0].schedule.map((row) => row.weekday)).toContain(2);
  });

  it("cannot close over or inactivate a person with a booked lesson", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(
      callAs(db, desk, "close_day", {
        p_support: ozodbek,
        p_date: "2030-01-08",
      }),
      "BOOKINGS_AFFECTED_OWNER_ONLY",
    );
    await rejects(
      callAs(db, desk, "admin_set_archived", {
        p_user: aziza,
        p_archived: true,
      }),
      "OPEN_BOOKINGS_OWNER_ONLY",
    );
    await rejects(
      callAs(db, desk, "admin_update_user", {
        p_user: aziza,
        p_first: "Aziza",
        p_last: "Karimova",
        p_birth_year: 2008,
        p_bio: "",
        p_active: false,
      }),
      "FORBIDDEN",
    );
    expect((await statusOf(b.id)).status).toBe("booked");
  });
});

describe("lesson now", () => {
  const now = at("2030-01-08", "14:20");
  const ask = (who, support, topic = "Speaking") =>
    callAs(db, who, "instant_request", { p_support: support, p_topic: topic });
  const answer = (who, id, accept = true) =>
    callAs(db, who, "instant_answer", { p_request: id, p_accept: accept });
  const free = async (who = aziza) =>
    (await callAs(db, who, "instant_supports")).supports.map((s) => s.name);
  const here = (support, present = true) =>
    callAs(db, support, "set_at_center", { p_present: present });
  beforeEach(async () => {
    await setNow(now);
    await here(ozodbek);
    await here(malika);
  });

  it("books the nearest session, not the minute the student asks", async () => {
    const iso = (value) => new Date(value).toISOString();
    await setNow(MONDAY);
    await book(bobur, ozodbek, at("2030-01-08", "17:00"));
    await setNow(at("2030-01-08", "16:52"));
    const { supports } = await callAs(db, aziza, "instant_supports");
    expect(supports.map((s) => [s.name, iso(s.starts_at)])).toEqual([
      ["Malika Test", iso(at("2030-01-08", "17:00"))],
    ]);
    await rejects(ask(aziza, ozodbek), "SLOT_UNAVAILABLE");

    const request = await ask(aziza, malika);
    expect(iso(request.starts_at)).toBe(iso(at("2030-01-08", "17:00")));
    const [incoming] = await callAs(db, malika, "instant_inbox");
    expect(incoming).toMatchObject({ seconds_left: 300 });
    expect(iso(incoming.starts_at)).toBe(iso(at("2030-01-08", "17:00")));
    const note = (await notificationsOf(malika)).find(
      (n) => n.type === "instant_request",
    );
    expect(note.body).toContain("17:00");

    await setNow(at("2030-01-08", "16:54"));
    expect((await callAs(db, aziza, "instant_inbox")).seconds_left).toBe(180);
    await answer(malika, request.id);
    const { rows } = await db.query(
      "select * from public.bookings where instant",
    );
    expect(iso(rows[0].starts_at)).toBe(iso(at("2030-01-08", "17:00")));
    expect(iso(rows[0].ends_at)).toBe(iso(at("2030-01-08", "17:30")));
    const accepted = (await notificationsOf(aziza)).find(
      (n) => n.type === "instant_accepted",
    );
    expect(accepted.body).toContain("17:00");

    await setNow(at("2030-01-08", "17:30"));
    expect(
      (await callAs(db, bobur, "instant_supports")).supports.map((s) =>
        iso(s.starts_at),
      ),
    ).toEqual([iso(at("2030-01-08", "17:30")), iso(at("2030-01-08", "17:30"))]);
    await setNow(at("2030-01-08", "13:40"));
    expect(
      (await callAs(db, bobur, "instant_supports")).supports.map((s) =>
        iso(s.starts_at),
      ),
    ).toEqual([iso(at("2030-01-08", "14:00")), iso(at("2030-01-08", "14:00"))]);
  });

  it("rounds to the nearest session, and books one that began a few minutes ago", async () => {
    const iso = (value) => new Date(value).toISOString();
    const sessionAt = async (time) => {
      await setNow(at("2030-01-08", time));
      return (await callAs(db, aziza, "instant_supports")).supports.map((s) =>
        iso(s.starts_at),
      );
    };
    const both = (time) => [
      iso(at("2030-01-08", time)),
      iso(at("2030-01-08", time)),
    ];
    expect(await sessionAt("17:01")).toEqual(both("17:00"));
    expect(await sessionAt("17:14")).toEqual(both("17:00"));
    expect(await sessionAt("17:15")).toEqual(both("17:30"));
    expect(await sessionAt("16:44")).toEqual(both("16:30"));
    expect(await sessionAt("16:45")).toEqual(both("17:00"));
    expect(await sessionAt("17:50")).toEqual([]);

    await setNow(at("2030-01-08", "17:01"));
    await answer(malika, (await ask(aziza, malika)).id);
    const { rows } = await db.query(
      "select * from public.bookings where instant",
    );
    expect(iso(rows[0].starts_at)).toBe(iso(at("2030-01-08", "17:00")));
    await setNow(at("2030-01-08", "17:02"));
    const marked = await callAs(db, malika, "mark_attendance", {
      p_booking: rows[0].id,
      p_status: "attended",
    });
    expect(marked.status).toBe("attended");
  });

  it("lists only support teachers free for their nearest session, inside their hours", async () => {
    await setNow(MONDAY);
    await book(bobur, ozodbek, at("2030-01-08", "14:30"));
    await setNow(now);
    expect(await free()).toEqual(["Malika Test"]);
    await setNow(at("2030-01-08", "17:45"));
    expect(await free()).toEqual([]);
    await setNow(at("2030-01-08", "10:00"));
    expect(await free()).toEqual([]);
  });

  it("books the lesson when the support accepts, next to a lesson already booked", async () => {
    const later = await book(aziza, ozodbek, at("2030-01-09", "14:00"));
    const request = await ask(aziza, malika);
    expect(
      (await notificationsOf(malika)).some((n) => n.type === "instant_request"),
    ).toBe(true);
    const [waiting] = await callAs(db, malika, "instant_inbox");
    expect(waiting).toMatchObject({
      id: request.id,
      student_name: "Aziza Karimova",
      topic: "Speaking",
    });

    await answer(malika, request.id);
    const { rows } = await db.query(
      "select * from public.bookings where support_id = $1 and instant",
      [malika],
    );
    expect(rows[0]).toMatchObject({
      status: "booked",
      student_id: aziza,
      topic: "Speaking",
    });
    expect(new Date(rows[0].starts_at).toISOString()).toBe(
      new Date(at("2030-01-08", "14:30")).toISOString(),
    );
    expect((await statusOf(later.id)).status).toBe("booked");
    expect((await callAs(db, aziza, "instant_inbox")).status).toBe("accepted");
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "instant_accepted"),
    ).toBe(true);

    await setNow(at("2030-01-08", "14:31"));
    const marked = await callAs(db, malika, "mark_attendance", {
      p_booking: rows[0].id,
      p_status: "attended",
    });
    expect(marked.status).toBe("attended");
  });

  it("allows one lesson now a day, and an hour of lessons a day in total", async () => {
    await answer(malika, (await ask(aziza, malika)).id);
    await setNow(at("2030-01-08", "15:00"));
    await rejects(ask(aziza, ozodbek), "INSTANT_DAILY_LIMIT");
    expect((await callAs(db, aziza, "instant_supports")).reason).toBe(
      "INSTANT_DAILY_LIMIT",
    );

    await setNow(MONDAY);
    await book(bobur, ozodbek, at("2030-01-08", "16:00"));
    await setNow(at("2030-01-08", "14:50"));
    await answer(malika, (await ask(bobur, malika)).id);
    await setting("instant_per_day", 2);
    await setNow(at("2030-01-08", "15:20"));
    await rejects(ask(bobur, ozodbek), "DAILY_TIME_LIMIT");
    await setting("instant_per_day", 1);
  });

  it("shows only support teachers who said they are at the center, for today only", async () => {
    await here(malika, false);
    expect(await free()).toEqual(["Ozodbek Test"]);
    await rejects(ask(aziza, malika), "SLOT_UNAVAILABLE");
    await setNow(at("2030-01-09", "14:05"));
    expect(await free()).toEqual([]);
    expect(await callAs(db, ozodbek, "support_presence")).toBe(false);
    await rejects(
      callAs(db, aziza, "set_at_center", { p_present: true }),
      "FORBIDDEN",
    );
  });

  it("shows lessons now on their own and in the totals of every report", async () => {
    await answer(malika, (await ask(aziza, malika)).id);
    const { rows } = await db.query(
      "select id from public.bookings where instant",
    );
    await setNow(at("2030-01-08", "14:31"));
    await callAs(db, malika, "mark_attendance", {
      p_booking: rows[0].id,
      p_status: "attended",
    });
    const [month] = (
      await callAs(db, admin, "admin_month_report", { p_month: "2030-01-01" })
    ).filter((r) => r.name.startsWith("Malika"));
    expect(month).toMatchObject({ lessons: 1, instant: 1 });
    const [pair] = await callAs(db, admin, "admin_pairs", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    expect(pair).toMatchObject({ lessons: 1, instant: 1 });
    const stats = await callAs(db, admin, "admin_stats", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    expect(stats.totals).toMatchObject({ attended: 1, instant: 1 });
  });

  it("refuses a banned student, one who gave up a lesson today, a second request and a busy student", async () => {
    await setNow(now);
    const own = await book(bobur, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, bobur, "cancel_booking", { p_booking: own.id });
    await rejects(ask(bobur, malika), "REBOOK_LATER");

    await ask(aziza, malika);
    await rejects(ask(aziza, ozodbek), "INSTANT_PENDING");

    await callAs(db, admin, "admin_add_ban", {
      p_student: aziza,
      p_hours: 24,
      p_reason: "x",
    });
    const [request] = await callAs(db, malika, "instant_inbox");
    await rejects(answer(malika, request.id), "STUDENT_BANNED");
  });

  it("ends an unanswered request, and tells everyone else when one is accepted", async () => {
    await setNow(now);
    const first = await ask(aziza, malika);
    const second = await ask(bobur, malika);
    await answer(malika, first.id);
    expect((await callAs(db, bobur, "instant_inbox")).status).toBe("declined");
    expect(
      (await notificationsOf(bobur)).some((n) => n.type === "instant_declined"),
    ).toBe(true);
    await rejects(answer(malika, second.id), "INSTANT_EXPIRED");

    await setNow(at("2030-01-08", "15:00"));
    await setting("instant_per_day", 2);
    const late = await ask(bobur, ozodbek);
    await setNow(at("2030-01-08", "15:06"));
    expect(await callAs(db, ozodbek, "instant_inbox")).toEqual([]);
    expect((await callAs(db, bobur, "instant_inbox")).status).toBe("expired");
    await rejects(answer(ozodbek, late.id), "INSTANT_EXPIRED");
    await setting("instant_per_day", 1);
  });

  it("belongs to the right people, and can be turned off", async () => {
    await setNow(now);
    await rejects(
      callAs(db, ozodbek, "instant_request", {
        p_support: malika,
        p_topic: "",
      }),
      "FORBIDDEN",
    );
    const request = await ask(aziza, malika);
    await rejects(answer(aziza, request.id), "FORBIDDEN");
    await rejects(answer(ozodbek, request.id), "FORBIDDEN");
    await callAs(db, aziza, "instant_cancel", { p_request: request.id });
    expect(await callAs(db, malika, "instant_inbox")).toEqual([]);

    await setting("instant_enabled", false);
    expect(await free()).toEqual([]);
    await rejects(ask(aziza, malika), "INSTANT_DISABLED");
    await setting("instant_enabled", true);
  });
});

describe("history and contact", () => {
  it("gives a support every lesson and counts them by period", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    const other = await book(bobur, ozodbek, at("2030-01-09", "14:00"));
    await callAs(db, bobur, "cancel_booking", { p_booking: other.id });

    expect(await callAs(db, ozodbek, "my_history")).toHaveLength(2);
    expect(await callAs(db, malika, "my_history")).toHaveLength(0);
    const counts = await callAs(db, ozodbek, "my_attendance");
    expect(counts.week).toMatchObject({
      attended: 1,
      cancelled: 1,
      no_show: 0,
    });
    expect(counts.month.attended).toBe(1);

    await setNow(at("2030-01-15", "10:00"));
    const later = await callAs(db, ozodbek, "my_attendance");
    expect(later.week.attended).toBe(0);
    expect(later.month.attended).toBe(1);
    expect(later.all.attended).toBe(1);
    expect(
      (await callAs(db, admin, "admin_attendance", { p_user: ozodbek })).all
        .attended,
    ).toBe(1);
  });

  it("does not cut a long history off", async () => {
    await db.query(
      `insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at, status)
      select $1, $2, d::date, d, d + interval '30 minutes', 'attended'
      from generate_series('2020-01-01'::timestamptz, '2020-01-01'::timestamptz + interval '249 days', interval '1 day') d`,
      [aziza, ozodbek],
    );
    expect(await callAs(db, aziza, "my_history")).toHaveLength(250);
  });

  it("shows the phone of a support only to the student who has a lesson with them", async () => {
    await callAs(db, admin, "admin_update_user", {
      p_user: ozodbek,
      p_first: "Ozodbek",
      p_last: "Test",
      p_birth_year: 1999,
      p_bio: "",
      p_active: true,
      p_phone: "+998 90 000 00 01",
    });
    expect((await callAs(db, aziza, "student_home")).support_phone).toBeNull();
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    expect((await callAs(db, aziza, "student_home")).support_phone).toBe(
      "+998 90 000 00 01",
    );
    expect((await callAs(db, bobur, "student_home")).support_phone).toBeNull();
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect((await callAs(db, aziza, "student_home")).support_phone).toBeNull();
  });

  it("keeps the phone when other details are saved", async () => {
    const save = (phone) =>
      callAs(db, admin, "admin_update_user", {
        p_user: ozodbek,
        p_first: "Ozodbek",
        p_last: "New",
        p_birth_year: 1999,
        p_bio: "",
        p_active: true,
        ...(phone ? { p_phone: phone } : {}),
      });
    await save("+998 90 000 00 02");
    await save();
    const { rows } = await db.query(
      "select phone from public.profiles where id = $1",
      [ozodbek],
    );
    expect(rows[0].phone).toBe("+998 90 000 00 02");
  });
});

describe("favorite supports", () => {
  it("turns on and off, and belongs to one student", async () => {
    expect(
      await callAs(db, aziza, "toggle_favorite", { p_support: malika }),
    ).toBe(true);
    expect((await callAs(db, aziza, "booking_options")).favorites).toEqual([
      malika,
    ]);
    expect((await callAs(db, bobur, "booking_options")).favorites).toEqual([]);
    expect(
      await callAs(db, aziza, "toggle_favorite", { p_support: malika }),
    ).toBe(false);
    expect((await callAs(db, aziza, "booking_options")).favorites).toEqual([]);
    await rejects(
      callAs(db, ozodbek, "toggle_favorite", { p_support: malika }),
      "FORBIDDEN",
    );
  });
});

describe("waiting list", () => {
  const slot = at("2030-01-08", "14:00");
  const join = (who, starts = slot) =>
    callAs(db, who, "join_waitlist", {
      p_support: ozodbek,
      p_starts_at: starts,
    });
  const waits = async (id) =>
    (await notificationsOf(id)).filter((n) => n.type === "waitlist_free");

  it("tells the waiting student when the time frees up, once", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    const [notice] = await waits(bobur);
    expect(notice.body).toContain("Ozodbek Test");
    expect(notice.body).not.toContain("Aziza");
    expect(await waits(bobur)).toHaveLength(1);

    await book(bobur, ozodbek, slot);
    expect(
      (await db.query("select count(*)::int as n from public.waitlist")).rows[0]
        .n,
    ).toBe(0);
  });

  it("stays quiet about a time freed on its own day, which nobody can book", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await setNow(at("2030-01-08", "09:00"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "excused",
      p_reason: "Sick",
    });
    expect(await waits(bobur)).toHaveLength(0);
  });

  it("skips someone who cannot book until tomorrow", async () => {
    const own = await book(bobur, malika, at("2030-01-09", "14:00"));
    await callAs(db, bobur, "cancel_booking", { p_booking: own.id });
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect(await waits(bobur)).toHaveLength(0);
  });

  it("also fires when the admin deletes or moves the lesson", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await callAs(db, admin, "admin_delete_booking", { p_booking: b.id });
    expect(await waits(bobur)).toHaveLength(1);
  });

  it("stays quiet while the time is not really free", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await callAs(db, ozodbek, "close_day", {
      p_support: ozodbek,
      p_date: "2030-01-08",
    });
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
    expect(await waits(bobur)).toHaveLength(0);
  });

  it("stays quiet when a lesson moves over its own old time", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await callAs(db, admin, "admin_move_booking", {
      p_booking: b.id,
      p_support: ozodbek,
      p_starts_at: at("2030-01-08", "14:15"),
    });
    expect(await waits(bobur)).toHaveLength(0);
  });

  it("skips someone who already has a lesson booked", async () => {
    const b = await book(aziza, ozodbek, slot);
    await join(bobur);
    await book(bobur, malika, at("2030-01-09", "14:00"));
    await callAs(db, aziza, "cancel_booking", { p_booking: b.id });
    expect(await waits(bobur)).toHaveLength(0);
  });

  it("refuses a free time, a closed time and more than the limit", async () => {
    await rejects(join(bobur), "WAITLIST_NOT_NEEDED");
    await callAs(db, malika, "close_day", {
      p_support: malika,
      p_date: "2030-01-08",
      p_from: "14:00",
      p_to: "15:00",
    });
    await rejects(
      callAs(db, bobur, "join_waitlist", {
        p_support: malika,
        p_starts_at: slot,
      }),
      "WAITLIST_NOT_NEEDED",
    );
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setting("waitlist_max", 1);
    await join(bobur);
    await db.query(
      `insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at)
      values ($1, $2, '2030-01-08', $3, $4)`,
      [admin, ozodbek, at("2030-01-08", "15:00"), at("2030-01-08", "15:30")],
    );
    await rejects(join(bobur, at("2030-01-08", "15:00")), "WAITLIST_FULL");
    await setting("waitlist_max", 3);
  });

  it("marks taken slots without revealing who took them", async () => {
    await book(aziza, ozodbek, slot);
    await join(bobur);
    const day = await callAs(db, bobur, "day_availability", {
      p_date: "2030-01-08",
    });
    const taken = day
      .find((s) => s.name === "Ozodbek Test")
      .slots.find((s) => !s.is_free);
    expect(taken).toMatchObject({ can_wait: true, waiting: true });
    expect(JSON.stringify(day)).not.toContain("Aziza");
  });

  it("shows the admin who is waiting, and lets them remove a place", async () => {
    await book(aziza, ozodbek, slot);
    await join(bobur);
    const [row] = await callAs(db, admin, "admin_waitlist");
    expect(row.student_name).toBe("Bobur Test");
    await callAs(db, admin, "admin_remove_waitlist", { p_id: row.id });
    expect(await callAs(db, admin, "admin_waitlist")).toHaveLength(0);
    await rejects(callAs(db, aziza, "admin_waitlist"), "FORBIDDEN");
  });
});

describe("archive", () => {
  const archive = (user, archived = true) =>
    callAs(db, admin, "admin_set_archived", {
      p_user: user,
      p_archived: archived,
    });

  it("removes a support from the site, keeps every record, and can be undone", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    await archive(ozodbek);

    const listed = await callAs(db, bobur, "list_supports");
    expect(listed.map((s) => s.name)).toEqual(["Malika Test"]);
    expect(await callAs(db, ozodbek, "get_me")).toBeNull();

    const kept = await callAs(db, admin, "admin_user_detail", {
      p_user: ozodbek,
    });
    expect(kept.bookings).toHaveLength(1);
    expect(kept.profile.archived_at).toBeTruthy();
    const report = await callAs(db, admin, "admin_month_report", {
      p_month: "2030-01-01",
    });
    expect(report.find((row) => row.name === "Ozodbek Test").lessons).toBe(1);

    await archive(ozodbek, false);
    expect((await callAs(db, ozodbek, "get_me")).role).toBe("support");
  });

  it("moves the open lessons of an archived support", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await archive(ozodbek);
    expect((await statusOf(b.id)).status).toBe("needs_transfer");
  });

  it("cannot archive the admin", async () => {
    await rejects(archive(admin), "CANNOT_DEACTIVATE_ADMIN");
  });
});

describe("admin control of lessons", () => {
  it("moves a lesson to another support and time, and tells everyone", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const moved = await callAs(db, admin, "admin_move_booking", {
      p_booking: b.id,
      p_support: malika,
      p_starts_at: at("2030-01-09", "15:00"),
    });
    expect(moved).toMatchObject({ status: "booked", support_id: malika });
    expect(
      (await notificationsOf(aziza)).some((n) => n.type === "booking_moved"),
    ).toBe(true);
    expect(
      (await notificationsOf(ozodbek)).some(
        (n) => n.type === "booking_cancelled",
      ),
    ).toBe(true);
  });

  it("can shift a lesson by a few minutes over its own old time", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const moved = await callAs(db, admin, "admin_move_booking", {
      p_booking: b.id,
      p_support: ozodbek,
      p_starts_at: at("2030-01-08", "14:15"),
    });
    expect(moved.status).toBe("booked");
  });

  it("never moves a lesson onto a taken or past time, and leaves it unchanged", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await book(bobur, malika, at("2030-01-09", "15:00"));
    await rejects(
      callAs(db, admin, "admin_move_booking", {
        p_booking: b.id,
        p_support: malika,
        p_starts_at: at("2030-01-09", "15:00"),
      }),
      "SLOT_UNAVAILABLE",
    );
    await rejects(
      callAs(db, admin, "admin_move_booking", {
        p_booking: b.id,
        p_support: malika,
        p_starts_at: at("2030-01-06", "15:00"),
      }),
      "DATE_IN_PAST",
    );
    expect((await statusOf(b.id)).status).toBe("booked");
  });

  it("deleting a no-show lesson also removes its strike and ban", async () => {
    await callAs(db, admin, "admin_add_warning", {
      p_student: aziza,
      p_note: "Late",
    });
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:11"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "no_show",
    });
    expect((await callAs(db, aziza, "student_home")).ban).not.toBeNull();
    await callAs(db, admin, "admin_delete_booking", { p_booking: b.id });
    const home = await callAs(db, aziza, "student_home");
    expect(home.ban).toBeNull();
    expect(home.strikes).toBe(1);
  });

  it("edits a topic, a review and a ban", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, admin, "admin_update_booking", {
      p_booking: b.id,
      p_topic: "New topic",
    });
    const detail = await callAs(db, admin, "admin_user_detail", {
      p_user: aziza,
    });
    expect(detail.bookings[0].topic).toBe("New topic");

    await callAs(db, admin, "admin_add_ban", { p_student: bobur, p_hours: 24 });
    const { bans } = await callAs(db, admin, "admin_penalties");
    await callAs(db, admin, "admin_update_ban", {
      p_ban: bans[0].id,
      p_ends_at: at("2030-01-20", "10:00"),
    });
    const home = await callAs(db, bobur, "student_home");
    expect(new Date(home.ban.ends_at).toISOString()).toBe(
      "2030-01-20T05:00:00.000Z",
    );
  });
});

describe("admin messages and reports", () => {
  it("reaches one person or a whole group, never archived people", async () => {
    const send = (audience, user = null) =>
      callAs(db, admin, "admin_send_notice", {
        p_audience: audience,
        p_user: user,
        p_title: "Hi",
        p_body: "Text",
      });
    expect(await send("one", aziza)).toBe(1);
    expect(await send("student")).toBe(2);
    expect(await send("support")).toBe(2);
    expect(await send("all")).toBe(4);
    await callAs(db, admin, "admin_set_archived", {
      p_user: bobur,
      p_archived: true,
    });
    expect(await send("all")).toBe(3);
    expect(
      (await callAs(db, admin, "admin_notifications", { p_limit: 500 })).length,
    ).toBeGreaterThan(5);
  });

  it("shows who taught whom", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    const pairs = await callAs(db, admin, "admin_pairs", {
      p_from: "2030-01-01",
      p_to: "2030-12-31",
    });
    expect(pairs[0]).toMatchObject({
      support: "Ozodbek Test",
      student: "Aziza Karimova",
      lessons: 1,
    });
  });

  it("exports everything without any password", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Hello",
    });
    await db.query(
      "insert into public.account_passwords (user_id, ciphertext) values ($1, 'SECRET-COPY')",
      [aziza],
    );
    const data = await callAs(db, admin, "admin_export");
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining([
        "People",
        "Lessons",
        "Chats",
        "Reviews",
        "Activity log",
      ]),
    );
    expect(data.Lessons).toHaveLength(1);
    expect(data.Chats[0].message).toBe("Hello");
    expect(JSON.stringify(data)).not.toContain("SECRET-COPY");
  });

  it("finds lessons by support, with a limit that can grow", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await book(bobur, malika, at("2030-01-08", "15:00"));
    const args = { p_from: "2030-01-01", p_to: "2030-12-31" };
    expect(
      await callAs(db, admin, "admin_bookings", { ...args, p_support: malika }),
    ).toHaveLength(1);
    expect(
      await callAs(db, admin, "admin_bookings", { ...args, p_limit: 1 }),
    ).toHaveLength(1);
    expect(await callAs(db, admin, "admin_bookings", args)).toHaveLength(2);
  });

  it("closes every new admin function to students and supports", async () => {
    const calls = [
      ["admin_export", {}],
      ["admin_pairs", { p_from: "2030-01-01", p_to: "2030-01-31" }],
      ["admin_set_archived", { p_user: bobur, p_archived: true }],
      [
        "admin_send_notice",
        { p_audience: "all", p_user: null, p_title: "x", p_body: "y" },
      ],
      ["admin_notifications", {}],
      ["admin_delete_booking", { p_booking: aziza }],
      ["admin_delete_message", { p_message: aziza }],
      ["admin_send_message", { p_booking: aziza, p_body: "x" }],
      [
        "admin_move_booking",
        { p_booking: aziza, p_support: malika, p_starts_at: MONDAY },
      ],
      ["admin_update_booking", { p_booking: aziza, p_topic: "x" }],
      ["admin_add_warning", { p_student: bobur, p_note: "x" }],
      ["admin_update_ban", { p_ban: aziza, p_ends_at: MONDAY }],
      ["admin_update_review", { p_review: aziza, p_rating: 5, p_comment: "" }],
      ["admin_attendance", { p_user: bobur }],
      ["admin_attendance_series", { p_user: bobur, p_unit: "week" }],
      ["admin_complaints", {}],
      ["admin_user_extras", { p_user: bobur }],
      ["admin_clear_rebook", { p_student: bobur }],
      ["admin_set_ranking_hidden", { p_user: bobur, p_hidden: true }],
      ["admin_delete_complaint", { p_complaint: aziza }],
      ["admin_answer_complaint", { p_complaint: aziza, p_reply: "x" }],
    ];
    for (const who of [aziza, ozodbek]) {
      for (const [fn, args] of calls)
        await rejects(callAs(db, who, fn, args), "FORBIDDEN");
    }
    for (const [fn, args] of calls)
      await rejects(callAs(db, null, fn, args), "permission denied");
  });
});

describe("admin in chats", () => {
  it("writes in any chat, and both sides see it comes from the admin", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, admin, "admin_send_message", {
      p_booking: b.id,
      p_body: "Be polite",
    });
    const chat = await callAs(db, aziza, "chat_messages", { p_booking: b.id });
    expect(chat.messages[0]).toMatchObject({
      body: "Be polite",
      sender: "Admin",
      from_admin: true,
    });
    expect(
      (await notificationsOf(ozodbek)).some((n) => n.type === "chat_message"),
    ).toBe(true);
  });

  it("hides a deleted message from both sides but keeps it for the admin", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const m = await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Rude words",
    });
    await callAs(db, admin, "admin_delete_message", { p_message: m.id });

    expect(
      (await callAs(db, ozodbek, "chat_messages", { p_booking: b.id }))
        .messages,
    ).toHaveLength(0);
    expect((await callAs(db, aziza, "chat_list"))[0].last_message).toBeNull();
    const seen = (await callAs(db, admin, "chat_messages", { p_booking: b.id }))
      .messages;
    expect(seen[0].body).toBe("Rude words");
    expect(seen[0].deleted_at).toBeTruthy();

    await callAs(db, admin, "admin_delete_message", {
      p_message: m.id,
      p_deleted: false,
    });
    expect(
      (await callAs(db, ozodbek, "chat_messages", { p_booking: b.id }))
        .messages,
    ).toHaveLength(1);
  });
});

describe("admin reading chats", () => {
  it("sees every chat, newest first, including ones already closed", async () => {
    const first = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: first.id,
      p_body: "Older chat",
    });
    await callAs(db, aziza, "cancel_booking", { p_booking: first.id });
    const second = await book(bobur, malika, at("2030-01-08", "15:00"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await callAs(db, malika, "send_message", {
      p_booking: second.id,
      p_body: "Newer chat",
    });

    const list = await callAs(db, admin, "chat_list");
    expect(list.map((chat) => chat.last_message)).toEqual([
      "Newer chat",
      "Older chat",
    ]);
  });

  it("keeps the chat after an account is made inactive", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Keep me",
    });
    await callAs(db, admin, "admin_update_user", {
      p_user: aziza,
      p_first: "Aziza",
      p_last: "Karimova",
      p_birth_year: null,
      p_bio: "",
      p_active: false,
    });
    const chat = await callAs(db, admin, "chat_messages", { p_booking: b.id });
    expect(chat.messages[0]).toMatchObject({
      body: "Keep me",
      sender: "Aziza Karimova",
    });
    const report = await callAs(db, admin, "admin_user_detail", {
      p_user: aziza,
    });
    expect(report.bookings).toHaveLength(1);
  });

  it("does not mark messages as read when the admin opens a chat", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await callAs(db, aziza, "send_message", {
      p_booking: b.id,
      p_body: "Hello",
    });
    await callAs(db, admin, "chat_messages", { p_booking: b.id });
    const list = await callAs(db, ozodbek, "chat_list");
    expect(list[0].unread).toBe(1);
  });
});

describe("reviews", () => {
  const attended = async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    return b;
  };
  const ended = async () => {
    const b = await attended();
    await setNow(at("2030-01-08", "14:31"));
    return b;
  };
  const rate = (b, rating, comment = "", who = aziza) =>
    callAs(db, who, "submit_review", {
      p_booking: b.id,
      p_rating: rating,
      p_comment: comment,
    });
  const maintain = () => db.query("select public.run_maintenance()");
  const typed = async (id, type) =>
    (await notificationsOf(id)).filter((n) => n.type === type);

  it("needs an attended lesson", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await rejects(rate(b, 5), "REVIEW_NOT_ALLOWED");
  });

  it("opens when the lesson ends and closes at midnight of the lesson day", async () => {
    const b = await attended();
    await rejects(rate(b, 5), "REVIEW_TOO_EARLY");
    expect((await callAs(db, aziza, "student_home")).pending_review).toBeNull();
    expect((await callAs(db, aziza, "my_history"))[0].can_review).toBe(false);

    await setNow(at("2030-01-08", "23:59"));
    const home = await callAs(db, aziza, "student_home");
    expect(home.pending_review.id).toBe(b.id);
    expect(new Date(home.pending_review.review_until).toISOString()).toBe(
      "2030-01-08T19:00:00.000Z",
    );
    expect((await callAs(db, aziza, "my_history"))[0].can_review).toBe(true);

    await setNow(at("2030-01-09", "00:00"));
    await rejects(rate(b, 5), "REVIEW_CLOSED");
    expect((await callAs(db, aziza, "student_home")).pending_review).toBeNull();
    expect((await callAs(db, aziza, "my_history"))[0].can_review).toBe(false);
  });

  it("stays open longer when the setting allows more days", async () => {
    await setting("review_days", 1);
    try {
      const b = await attended();
      await setNow(at("2030-01-09", "23:30"));
      expect((await rate(b, 5)).rating).toBe(5);
    } finally {
      await setting("review_days", 0);
    }
  });

  it("is given once", async () => {
    const b = await ended();
    await rate(b, 4, "Good");
    await rejects(rate(b, 1, "Changed my mind"), "REVIEW_EXISTS");
    const own = await callAs(db, aziza, "my_history");
    expect(own[0].review).toEqual({ rating: 4, comment: "Good" });
    expect(own[0].can_review).toBe(false);
  });

  it("shows comments and single ratings only to the center", async () => {
    const manager = await user("manager", "Reception");
    const b = await ended();
    await rate(b, 4, "Great");

    const detail = await callAs(db, bobur, "support_detail", {
      p_support: ozodbek,
    });
    expect(detail.rating).toEqual({ average: 4, count: 1 });
    expect(detail.reviews).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain("Great");
    expect(JSON.stringify(detail)).not.toContain("Aziza");

    const asSupport = await callAs(db, ozodbek, "my_history");
    expect(asSupport[0].review).toBeNull();
    expect(JSON.stringify(asSupport)).not.toContain("Great");
    const ownDetail = await callAs(db, ozodbek, "support_detail", {
      p_support: ozodbek,
    });
    expect(JSON.stringify(ownDetail)).not.toContain("Great");

    const own = await callAs(db, aziza, "my_history");
    expect(own[0].review).toEqual({ rating: 4, comment: "Great" });

    for (const staff of [admin, manager]) {
      const list = await callAs(db, staff, "admin_reviews");
      expect(list[0]).toMatchObject({
        rating: 4,
        comment: "Great",
        student_name: "Aziza Karimova",
      });
    }
  });

  it("drops out of the rating when the admin hides it", async () => {
    const b = await ended();
    const r = await rate(b, 1);
    await callAs(db, admin, "admin_set_review_hidden", {
      p_review: r.id,
      p_hidden: true,
    });
    const detail = await callAs(db, bobur, "support_detail", {
      p_support: ozodbek,
    });
    expect(detail.rating.count).toBe(0);
  });

  it("cannot be left for someone else", async () => {
    const b = await ended();
    await rejects(rate(b, 1, "", bobur), "FORBIDDEN");
  });

  it("asks for a rating once when the lesson ends, not at check-in", async () => {
    await attended();
    await maintain();
    expect(await typed(aziza, "review_request")).toHaveLength(0);

    await setNow(at("2030-01-08", "14:30"));
    await maintain();
    await maintain();
    const asked = await typed(aziza, "review_request");
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toContain("Tue, 08 Jan 23:59");
  });

  it("does not ask once rating has closed", async () => {
    await attended();
    await setNow(at("2030-01-09", "09:00"));
    await maintain();
    expect(await typed(aziza, "review_request")).toHaveLength(0);
  });

  it("reminds in the evening of the last day, unless rated or just asked", async () => {
    await setting("review_reminder_hour", 18);
    try {
      const cara = await user("student", "Cara");
      const early = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
      const rated = await book(cara, malika, at("2030-01-08", "14:00"));
      const late = await book(bobur, ozodbek, at("2030-01-08", "17:00"));
      await setNow(at("2030-01-08", "17:31"));
      for (const b of [early, rated, late]) {
        await callAs(db, admin, "mark_attendance", {
          p_booking: b.id,
          p_status: "attended",
        });
      }
      await rate(rated, 5, "", cara);

      await setNow(at("2030-01-08", "17:59"));
      await maintain();
      expect(await typed(aziza, "review_reminder")).toHaveLength(0);

      await setNow(at("2030-01-08", "18:00"));
      await maintain();
      await maintain();
      const reminded = await typed(aziza, "review_reminder");
      expect(reminded).toHaveLength(1);
      expect(reminded[0].body).toContain("Tue, 08 Jan 23:59");
      expect(await typed(cara, "review_reminder")).toHaveLength(0);
      expect(await typed(bobur, "review_reminder")).toHaveLength(0);
    } finally {
      await setting("review_reminder_hour", 20);
    }
  });

  it("tells the developer and reception about a low rating only", async () => {
    const manager = await user("manager", "Reception");
    const low = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    const fine = await book(bobur, malika, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:31"));
    for (const b of [low, fine]) {
      await callAs(db, admin, "mark_attendance", {
        p_booking: b.id,
        p_status: "attended",
      });
    }
    await rate(low, 2, "Late and rushed");
    await rate(fine, 3, "", bobur);

    for (const staff of [admin, manager]) {
      const alerts = await typed(staff, "review_low");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].title).toContain("2 of 5");
      expect(alerts[0].body).toContain("Late and rushed");
    }
    expect(await typed(ozodbek, "review_low")).toHaveLength(0);
    expect(await typed(malika, "review_low")).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("blocks every admin function for students and supports", async () => {
    for (const who of [aziza, ozodbek]) {
      await rejects(callAs(db, who, "admin_dashboard"), "FORBIDDEN");
      await rejects(callAs(db, who, "admin_config"), "FORBIDDEN");
      await rejects(
        callAs(db, who, "admin_save_setting", {
          p_key: "ban_days",
          p_value: "1",
        }),
        "FORBIDDEN",
      );
      await rejects(
        callAs(db, who, "admin_lift_ban", { p_ban: aziza }),
        "FORBIDDEN",
      );
    }
  });

  it("hides internal functions from the browser", async () => {
    await rejects(callAs(db, aziza, "run_maintenance"), "permission denied");
    await rejects(
      callAs(db, aziza, "release_user", { p_user: aziza }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "notify", { p_user: bobur, p_type: "ban" }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "recount_strikes", { p_student: aziza }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "attendance_summary", { p_user: bobur }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "rebook_from", { p_student: bobur }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "same_day_pass", { p_student: bobur }),
      "permission denied",
    );
    await rejects(
      callAs(db, aziza, "attendance_series", { p_user: bobur, p_unit: "week" }),
      "permission denied",
    );
  });

  it("keeps tables closed to direct access", async () => {
    for (const table of [
      "profiles",
      "bookings",
      "settings",
      "audit_log",
      "waitlist",
      "favorite_supports",
    ]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await tx.query(`select * from public.${table}`);
        }),
      ).rejects.toThrow("permission denied");
    }
  });

  it("does not let a deactivated student book", async () => {
    await db.query(
      "update public.profiles set is_active = false where id = $1",
      [aziza],
    );
    await rejects(book(aziza, ozodbek, at("2030-01-08", "14:00")), "FORBIDDEN");
  });

  it("shows no private data before login", async () => {
    const config = await callAs(db, null, "get_public_config");
    expect(Object.keys(config.settings)).not.toContain("ban_days");
    await rejects(callAs(db, null, "list_supports"), "permission denied");
  });
});

describe("admin settings", () => {
  it("changes a rule without touching code", async () => {
    await callAs(db, admin, "admin_save_setting", {
      p_key: "booking_max_days_ahead",
      p_value: "3",
    });
    await rejects(
      book(aziza, ozodbek, at("2030-01-11", "14:00")),
      "DATE_OUT_OF_RANGE",
    );
    await setting("booking_max_days_ahead", 7);
  });

  it("refuses nonsense values", async () => {
    const save = (key, value) =>
      callAs(db, admin, "admin_save_setting", { p_key: key, p_value: value });
    await rejects(save("lesson_minutes", "0"), "SETTING_INVALID");
    await rejects(save("reminder_evening_hour", "24"), "SETTING_INVALID");
    await rejects(save("review_reminder_hour", "24"), "SETTING_INVALID");
    await rejects(save("review_alert_rating", "6"), "SETTING_INVALID");
    await rejects(save("review_days", "31"), "SETTING_INVALID");
    await rejects(save("complaint_days", "31"), "SETTING_INVALID");
    await rejects(save("primary_color", '"red"'), "SETTING_INVALID");
    await rejects(save("chat_enabled", "1"), "SETTING_INVALID");
  });

  it("uses edited notification text", async () => {
    await callAs(db, admin, "admin_save_template", {
      p_type: "booking_confirmed",
      p_title: "Done",
      p_body: "See you at {{time}}",
      p_enabled: true,
    });
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    expect((await notificationsOf(aziza))[0]).toMatchObject({
      title: "Done",
      body: "See you at 14:00",
    });
  });

  it("records admin actions in the audit log", async () => {
    await callAs(db, admin, "admin_add_ban", {
      p_student: aziza,
      p_hours: 5,
      p_reason: "test",
    });
    const log = await callAs(db, admin, "admin_audit");
    expect(log[0]).toMatchObject({ action: "ban.add", actor: "Developer Test" });
  });
});

describe("passwords", () => {
  it("keeps the encrypted copies away from every browser role", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select * from public.account_passwords");
      }),
    ).rejects.toThrow("permission denied");
    await rejects(
      callAs(db, aziza, "record_password_change", { p_user: aziza }),
      "permission denied",
    );
  });

  it("tells the admin when someone changes their password", async () => {
    await db.query("select public.record_password_change($1)", [aziza]);
    expect((await notificationsOf(admin))[0].body).toBe(
      "Aziza Karimova changed their password.",
    );
    const users = await callAs(db, admin, "admin_list_users", {
      p_role: "student",
      p_search: "Aziza",
    });
    expect(users[0].password_changed_at).toBeTruthy();
  });
});

describe("month report", () => {
  it("counts each support for the calendar month only", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });

    const january = await callAs(db, admin, "admin_month_report", {
      p_month: "2030-01-01",
    });
    const row = january.find((item) => item.name === "Ozodbek Test");
    expect(row).toMatchObject({ lessons: 1, hours: 0.5, no_shows: 0 });

    const february = await callAs(db, admin, "admin_month_report", {
      p_month: "2030-02-01",
    });
    expect(february.find((item) => item.name === "Ozodbek Test").lessons).toBe(
      0,
    );
    await rejects(
      callAs(db, aziza, "admin_month_report", { p_month: "2030-01-01" }),
      "FORBIDDEN",
    );
  });
});

describe("stats", () => {
  it("counts lessons and attendance", async () => {
    const b = await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    await setNow(at("2030-01-08", "14:05"));
    await callAs(db, ozodbek, "mark_attendance", {
      p_booking: b.id,
      p_status: "attended",
    });
    const stats = await callAs(db, admin, "admin_stats", {
      p_from: "2030-01-01",
      p_to: "2030-01-31",
    });
    expect(stats.totals).toMatchObject({
      bookings: 1,
      attended: 1,
      attendance_rate: 100,
    });
    expect(
      stats.by_support.find((s) => s.name === "Ozodbek Test").lessons,
    ).toBe(1);
    expect(stats.by_day).toHaveLength(31);
  });
});

describe("notification links", () => {
  it("opens the calendar for a support teacher, home for a student, and fills empty links", async () => {
    await book(aziza, ozodbek, at("2030-01-08", "14:00"));
    expect((await callAs(db, ozodbek, "notifications_list"))[0].link).toBe(
      "/calendar",
    );
    expect((await callAs(db, aziza, "notifications_list"))[0].link).toBe("/");
    const { rows } =
      await db.query(`select public.notification_link('password_changed', '', 'student') as a,
      public.notification_link('complaint_new', '', 'admin') as b,
      public.notification_link('chat_message', '/chat/1', 'support') as c`);
    expect(rows[0]).toEqual({
      a: "/profile",
      b: "/admin/complaints",
      c: "/chat/1",
    });
  });
});

describe("error reports", () => {
  const report = (who, items) =>
    callAs(db, who, "report_client_errors", { p_items: JSON.stringify(items) });
  const serverError = (extra = {}) => ({
    kind: "server",
    message: 'null value in column "topic" violates not-null constraint',
    fn: "book_lesson",
    path: "/book",
    at: "2030-01-07T09:59:00+05:00",
    details: { args: { p_topic: null } },
    ...extra,
  });
  const errorAlerts = async (id) =>
    (await notificationsOf(id)).filter((n) => n.type === "app_error");
  const rows = async () =>
    (await db.query("select * from public.app_errors order by id")).rows;

  beforeEach(async () => {
    await db.exec("truncate public.app_errors");
  });

  it("keeps who, where and when, and tells the developer once per new problem", async () => {
    await report(aziza, [serverError()]);
    await report(aziza, [serverError({ repeats: 2 })]);
    await report(bobur, [serverError()]);

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ user_id: aziza, role: "student", repeats: 3, fn: "book_lesson" });
    expect(saved[0].happened_at.toISOString()).toBe("2030-01-07T04:59:00.000Z");
    const alerts = await errorAlerts(admin);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain("Aziza Karimova (student)");

    const [group] = await callAs(db, admin, "admin_errors");
    expect(group).toMatchObject({ kind: "server", times: 4, people: 2, fn: "book_lesson" });
    expect(group.cases.map((c) => c.name)).toEqual(["Bobur Test", "Aziza Karimova"]);
    expect(await callAs(db, admin, "admin_error_count")).toBe(1);
  });

  it("treats the same problem with other ids and numbers as one", async () => {
    await report(aziza, [serverError({ message: "booking 7b0c8e2a-1111-4222-8333-444455556666 failed at step 3" })]);
    await report(bobur, [serverError({ message: "booking 0f0c8e2a-9999-4222-8333-444455556666 failed at step 12" })]);
    expect(await callAs(db, admin, "admin_errors")).toHaveLength(1);
  });

  it("lists lost connections without a push and without counting them as faults", async () => {
    await report(aziza, [{ kind: "network", message: "TypeError: Failed to fetch", fn: "get_me", path: "/" }]);
    expect(await errorAlerts(admin)).toHaveLength(0);
    expect(await callAs(db, admin, "admin_error_count")).toBe(0);
    expect((await callAs(db, admin, "admin_errors"))[0].kind).toBe("network");
  });

  it("moves a fixed problem away, and brings it back if it happens again", async () => {
    await report(aziza, [serverError()]);
    const [group] = await callAs(db, admin, "admin_errors");
    await callAs(db, admin, "admin_error_fixed", { p_fingerprint: group.fingerprint, p_fixed: true });
    expect(await callAs(db, admin, "admin_errors")).toEqual([]);
    expect(await callAs(db, admin, "admin_errors", { p_fixed: true })).toHaveLength(1);
    expect(await callAs(db, admin, "admin_error_count")).toBe(0);

    await report(aziza, [serverError()]);
    expect(await callAs(db, admin, "admin_errors")).toHaveLength(1);
    expect(await errorAlerts(admin)).toHaveLength(2);
    await rejects(
      callAs(db, admin, "admin_error_fixed", { p_fingerprint: "nope", p_fixed: true }),
      "ERROR_NOT_FOUND",
    );
  });

  it("is open to the developer only, and reports need a signed-in person", async () => {
    const manager = await user("manager", "Reception");
    await report(manager, [serverError()]);
    for (const who of [manager, ozodbek, aziza]) {
      await rejects(callAs(db, who, "admin_errors"), "FORBIDDEN");
      await rejects(callAs(db, who, "admin_error_count"), "FORBIDDEN");
      await rejects(
        callAs(db, who, "admin_error_fixed", { p_fingerprint: "x", p_fixed: true }),
        "FORBIDDEN",
      );
    }
    await expect(report(null, [serverError()])).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
  });

  it("skips junk, cuts long text, and stops a page that reports in a loop", async () => {
    await report(aziza, [
      { kind: "virus", message: "x" },
      "not an object",
      serverError({ message: "y".repeat(2000), at: "yesterday", repeats: "lots" }),
    ]);
    const [saved] = await rows();
    expect(saved.message).toHaveLength(500);
    expect(saved.repeats).toBe(1);
    expect(saved.happened_at.toISOString()).toBe(new Date(MONDAY).toISOString());
    expect(await rows()).toHaveLength(1);

    for (let i = 0; i < 40; i += 1) {
      await report(bobur, [serverError({ fn: `fn_${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${Math.floor(i / 26)}x` })]);
    }
    const fromBobur = (await rows()).filter((r) => r.user_id === bobur);
    expect(fromBobur).toHaveLength(30);
  });

  it("forgets problems after 30 days", async () => {
    await report(aziza, [serverError()]);
    await setNow("2030-02-07T10:00:00+05:00");
    expect(await callAs(db, admin, "admin_errors")).toEqual([]);
    expect(await rows()).toHaveLength(0);
  });
});

describe("staff attendance", () => {
  const CENTER = "40.3864, 71.7864";
  const NEAR = { p_lat: 40.387, p_lng: 71.787 };
  const FAR = { p_lat: 40.45, p_lng: 71.8 };
  const PHOTO = `data:image/jpeg;base64,${"A".repeat(200)}`;
  let reception;
  let noise = 0;

  const face = (seed) => {
    noise += 1;
    return Array.from({ length: 1024 }, (_, i) =>
      Math.round((Math.sin(seed * (i + 1)) * 2 + Math.sin(noise * 7.3 + i) * 0.02) * 1e4) / 1e4);
  };
  const OZODBEK = 1.1;
  const MALIKA = 2.7;

  const enable = async () => {
    await setting("staff_attendance_enabled", true);
    await setting("staff_center_location", CENTER);
    await callAs(db, admin, "admin_set_staff_face", {
      p_user: ozodbek, p_descriptor: JSON.stringify(face(OZODBEK)), p_photo: PHOTO,
    });
    await callAs(db, admin, "admin_set_staff_face", {
      p_user: malika, p_descriptor: JSON.stringify(face(MALIKA)), p_photo: PHOTO,
    });
  };

  const code = async () => (await callAs(db, reception, "staff_qr_screen")).code;

  const scan = async (who, place = NEAR) =>
    callAs(db, who, "staff_scan", { p_code: await code(), ...place, p_accuracy: 30 });

  const faceCheck = (who, scanId, seed) =>
    callAs(db, who, "staff_face", {
      p_scan: scanId,
      p_faces: JSON.stringify([face(seed), face(seed)]),
      p_photo: PHOTO,
      p_real: 0.9,
      p_live: 0.9,
    });

  const checkIn = async (who, seed, time) => {
    await setNow(at("2030-01-07", time));
    const started = await scan(who);
    return { started, result: await faceCheck(who, started.scan, seed) };
  };

  const today = async (who = ozodbek) => (await callAs(db, who, "my_staff_attendance")).today;
  const list = (from = "2030-01-07", to = from) =>
    callAs(db, admin, "staff_attendance_list", { p_from: from, p_to: to });

  beforeEach(async () => {
    await db.exec("delete from public.staff_qr_codes; delete from public.staff_face_hashes;");
    await setting("staff_attendance_enabled", false);
    await setting("staff_center_location", "");
    await setting("staff_gps_radius", 500);
    await setting("staff_late_minutes", 5);
    await setting("staff_early_minutes", 0);
    await setting("staff_face_match", 60);
    await setting("staff_photo_days", 60);
    reception = await user("manager", "Reception");
  });

  it("compares faces the way the face library does", async () => {
    const sim = async (a, b) => (await db.query(
      "select public.face_similarity($1::real[], $2::real[]) as s", [a, b])).rows[0].s;
    expect(await sim(face(OZODBEK), face(OZODBEK))).toBeGreaterThan(0.9);
    expect(await sim(face(OZODBEK), face(MALIKA))).toBe(0);
    expect(await sim(face(OZODBEK), face(OZODBEK).slice(0, 512))).toBe(0);
  });

  it("is off until the developer turns it on and sets it up", async () => {
    await rejects(callAs(db, reception, "staff_qr_screen"), "ATTENDANCE_OFF");
    await rejects(callAs(db, ozodbek, "staff_scan", { p_code: "x", ...NEAR }), "ATTENDANCE_OFF");

    await setting("staff_attendance_enabled", true);
    await rejects(scan(ozodbek), "ATTENDANCE_NOT_SET_UP");
    await setting("staff_center_location", CENTER);
    await rejects(scan(ozodbek), "FACE_NOT_SET");
  });

  it("lets only staff show the code and only the developer set a face", async () => {
    await enable();
    await rejects(callAs(db, aziza, "staff_qr_screen"), "FORBIDDEN");
    await rejects(callAs(db, ozodbek, "staff_qr_screen"), "FORBIDDEN");
    await rejects(callAs(db, aziza, "staff_scan", { p_code: await code(), ...NEAR }), "FORBIDDEN");
    const setFace = (who, target) => callAs(db, who, "admin_set_staff_face", {
      p_user: target, p_descriptor: JSON.stringify(face(OZODBEK)), p_photo: PHOTO,
    });
    await rejects(setFace(reception, ozodbek), "FORBIDDEN");
    await rejects(setFace(admin, aziza), "FORBIDDEN");
    await rejects(callAs(db, admin, "admin_set_staff_face", {
      p_user: ozodbek, p_descriptor: JSON.stringify(["a", ...face(OZODBEK).slice(1)]), p_photo: PHOTO,
    }), "FACE_INVALID");
    await rejects(callAs(db, admin, "admin_set_staff_face", {
      p_user: ozodbek, p_descriptor: JSON.stringify(face(OZODBEK)), p_photo: "data:text/html,hi",
    }), "FACE_INVALID");
    await rejects(callAs(db, reception, "admin_staff_face", { p_user: ozodbek }), "FORBIDDEN");
    expect((await callAs(db, admin, "admin_staff_face", { p_user: ozodbek })).photo).toBe(PHOTO);
  });

  it("changes the code every 10 seconds, and a code works once, within 20 seconds", async () => {
    await enable();
    const first = await code();
    expect(await code()).toBe(first);
    await setNow("2030-01-07T10:00:09+05:00");
    expect(await code()).toBe(first);
    await setNow("2030-01-07T10:00:10+05:00");
    const second = await code();
    expect(second).not.toBe(first);

    await rejects(callAs(db, ozodbek, "staff_scan", { p_code: "nope", ...NEAR }), "QR_INVALID");
    await setNow("2030-01-07T10:00:31+05:00");
    await rejects(callAs(db, ozodbek, "staff_scan", { p_code: second, ...NEAR }), "QR_EXPIRED");

    const third = await code();
    await callAs(db, ozodbek, "staff_scan", { p_code: third, ...NEAR });
    await rejects(callAs(db, malika, "staff_scan", { p_code: third, ...NEAR }), "QR_USED");
    expect(await code()).not.toBe(third);
  });

  it("refuses a scan away from the center, and keeps the code for a retry", async () => {
    await enable();
    const live = await code();
    await rejects(callAs(db, ozodbek, "staff_scan", { p_code: live, ...FAR }), "TOO_FAR");
    await rejects(callAs(db, ozodbek, "staff_scan", { p_code: live, p_lat: null, p_lng: null }), "GPS_NEEDED");
    await setting("staff_gps_radius", 10000);
    expect((await callAs(db, ozodbek, "staff_scan", { p_code: live, ...FAR })).kind).toBe("arrive");
  });

  it("records arriving and leaving after the face check, and shows it on the reception screen", async () => {
    await enable();
    const { started, result } = await checkIn(ozodbek, OZODBEK, "13:58");
    expect(started.kind).toBe("arrive");
    expect(result.ok).toBe(true);
    expect(result.day.status).toBe("here");
    expect(await callAs(db, ozodbek, "support_presence")).toBe(true);
    const screen = await callAs(db, reception, "staff_qr_screen");
    expect(screen.events.map((e) => [e.name, e.kind])).toEqual([["Ozodbek Test", "arrive"]]);

    await setNow(at("2030-01-07", "17:00"));
    expect((await scan(ozodbek)).early).toBe(true);
    await setNow(at("2030-01-07", "18:03"));
    const leaving = await scan(ozodbek);
    expect(leaving).toMatchObject({ kind: "leave", early: false });
    expect((await faceCheck(ozodbek, leaving.scan, OZODBEK)).ok).toBe(true);
    expect(await callAs(db, ozodbek, "support_presence")).toBe(false);

    const day = await today();
    expect(day).toMatchObject({
      status: "done", is_late: false, is_early: false, no_leave: false, worked_minutes: 245,
      face_checks: 2, face_failed: 0,
    });
    await rejects(scan(ozodbek), "ATTENDANCE_DONE");
  });

  it("refuses another face, three times per scan, and keeps the photos for the developer", async () => {
    await enable();
    await setNow(at("2030-01-07", "13:58"));
    const started = await scan(ozodbek);
    expect(await faceCheck(ozodbek, started.scan, MALIKA)).toEqual({ ok: false, tries_left: 2 });
    expect(await faceCheck(ozodbek, started.scan, MALIKA)).toEqual({ ok: false, tries_left: 1 });
    expect(await faceCheck(ozodbek, started.scan, MALIKA)).toEqual({ ok: false, tries_left: 0 });
    await rejects(faceCheck(ozodbek, started.scan, OZODBEK), "SCAN_CLOSED");
    expect((await today()).arrived_at).toBeNull();

    const checks = await callAs(db, admin, "admin_staff_face_checks", {
      p_support: ozodbek, p_date: "2030-01-07",
    });
    expect(checks.map((c) => [c.passed, c.photo])).toEqual([[false, PHOTO], [false, PHOTO], [false, PHOTO]]);
    await rejects(callAs(db, reception, "admin_staff_face_checks", {
      p_support: ozodbek, p_date: "2030-01-07",
    }), "FORBIDDEN");
  });

  it("needs every face seen during the check to match", async () => {
    await enable();
    await setNow(at("2030-01-07", "13:58"));
    const started = await scan(ozodbek);
    const result = await callAs(db, ozodbek, "staff_face", {
      p_scan: started.scan,
      p_faces: JSON.stringify([face(OZODBEK), face(MALIKA)]),
      p_photo: PHOTO,
    });
    expect(result.ok).toBe(false);
  });

  it("never accepts the same face numbers twice", async () => {
    await enable();
    await setNow(at("2030-01-07", "13:58"));
    const started = await scan(ozodbek);
    const sent = [face(OZODBEK), face(OZODBEK)];
    const send = (faces) => callAs(db, ozodbek, "staff_face", {
      p_scan: started.scan, p_faces: JSON.stringify(faces), p_photo: PHOTO,
    });
    const reference = (await db.query(
      "select descriptor from public.staff_faces where user_id = $1", [ozodbek])).rows[0].descriptor;
    await rejects(send([reference, face(OZODBEK)]), "FACE_REPLAY");
    await rejects(send([sent[0], sent[0]]), "FACE_REPLAY");
    await send([sent[0], face(MALIKA)]);
    await rejects(send([sent[0], face(OZODBEK)]), "FACE_REPLAY");
    await rejects(send([face(OZODBEK)]), "FACE_INVALID");
    await rejects(send([face(OZODBEK).slice(0, 500), face(OZODBEK).slice(0, 500)]), "FACE_INVALID");
  });

  it("gives the face check three minutes and only to the teacher who scanned", async () => {
    await enable();
    await setNow(at("2030-01-07", "13:58"));
    const started = await scan(ozodbek);
    await rejects(faceCheck(malika, started.scan, MALIKA), "FORBIDDEN");
    await setNow(at("2030-01-07", "14:02"));
    await rejects(faceCheck(ozodbek, started.scan, OZODBEK), "SCAN_EXPIRED");
  });

  it("tells reception and the developer when a teacher comes late", async () => {
    await enable();
    await checkIn(malika, MALIKA, "14:05");
    expect(await notificationsOf(admin)).toEqual([]);
    const { result } = await checkIn(ozodbek, OZODBEK, "14:12");
    expect(result.day).toMatchObject({ is_late: true, late_minutes: 12 });
    for (const who of [admin, reception]) {
      expect(await notificationsOf(who)).toEqual([{
        type: "staff_late", title: "Ozodbek Test came late", body: "Ozodbek Test arrived at 14:12, 12 min late.",
      }]);
    }
  });

  it("reminds a teacher who has not scanned in, and reports an absence at the end of work time", async () => {
    await enable();
    await db.query("select public.run_maintenance()");
    expect((await list()).map((d) => [d.support_name, d.status])).toEqual([
      ["Malika Test", "waiting"], ["Ozodbek Test", "waiting"],
    ]);
    await checkIn(malika, MALIKA, "13:50");

    await setNow(at("2030-01-07", "14:06"));
    await db.query("select public.run_maintenance()");
    await db.query("select public.run_maintenance()");
    expect(await notificationsOf(ozodbek)).toEqual([{
      type: "staff_reminder", title: "Scan the attendance QR",
      body: "Your work time started at 14:00. Scan the QR at reception when you arrive.",
    }]);
    expect(await notificationsOf(malika)).toEqual([]);
    expect((await today()).status).toBe("missing");

    await setNow(at("2030-01-07", "18:00"));
    await db.query("select public.run_maintenance()");
    await db.query("select public.run_maintenance()");
    const absent = (await notificationsOf(reception)).filter((n) => n.type === "staff_absent");
    expect(absent).toEqual([{
      type: "staff_absent", title: "Ozodbek Test did not come",
      body: "Ozodbek Test did not come on Mon, 07 Jan (work time 14:00-18:00).",
    }]);
    expect((await list()).map((d) => [d.support_name, d.status])).toEqual([
      ["Malika Test", "done"], ["Ozodbek Test", "absent"],
    ]);
  });

  it("does not count a day as missed when attendance is turned on during it", async () => {
    await setNow(at("2030-01-07", "15:00"));
    await enable();
    await db.query("select public.run_maintenance()");
    await setNow(at("2030-01-07", "18:30"));
    await db.query("select public.run_maintenance()");
    expect(await list()).toEqual([]);
    expect(await notificationsOf(admin)).toEqual([]);
  });

  it("follows closures: made in advance they excuse, made late they do not hide the start", async () => {
    await enable();
    await callAs(db, admin, "close_day", {
      p_support: ozodbek, p_date: "2030-01-07", p_reason: "Meeting", p_from: "14:00", p_to: "16:00",
    });
    await db.query(
      `insert into public.schedule_closures (support_id, closed_on, reason, created_by, created_at)
       values ($1, '2030-01-07', 'Ill', $1, $2)`, [malika, at("2030-01-07", "15:00")]);
    await db.query("select public.run_maintenance()");
    const days = await list();
    const of = (name) => days.find((d) => d.support_name === name);
    expect(new Date(of("Ozodbek Test").expected_start).toISOString()).toBe("2030-01-07T11:00:00.000Z");
    expect(new Date(of("Malika Test").expected_end).toISOString()).toBe("2030-01-07T10:00:00.000Z");

    await setNow(at("2030-01-07", "15:10"));
    await db.query("select public.run_maintenance()");
    expect((await list()).find((d) => d.support_name === "Malika Test").status).toBe("absent");

    await callAs(db, malika, "close_day", { p_support: malika, p_date: "2030-01-08" });
    await setNow(at("2030-01-08", "09:00"));
    await db.query("select public.run_maintenance()");
    expect((await list("2030-01-08")).map((d) => d.support_name)).toEqual(["Ozodbek Test"]);
  });

  it("counts a teacher who forgets to scan out until the last proof they were there", async () => {
    await enable();
    await checkIn(ozodbek, OZODBEK, "13:59");
    await db.query(
      `insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at, status)
       values ($1, $2, '2030-01-07', $3, $4, 'attended')`,
      [aziza, ozodbek, at("2030-01-07", "15:00"), at("2030-01-07", "15:30")]);
    await setNow(at("2030-01-08", "09:00"));
    const [day] = await list();
    expect(day).toMatchObject({
      status: "done", no_leave: true, is_early: true, early_minutes: 150, worked_minutes: 91,
    });
    expect(new Date(day.left_estimated).toISOString()).toBe("2030-01-07T10:30:00.000Z");
  });

  it("lets reception fill in a time by hand, with a note, and only the developer change one", async () => {
    await enable();
    await setNow(at("2030-01-07", "15:00"));
    const mark = (who, args) => callAs(db, who, "staff_mark", {
      p_support: ozodbek, p_date: "2030-01-07", p_arrived: null, p_left: null, p_note: "QR screen was off", ...args,
    });
    await rejects(mark(reception, { p_arrived: "14:10", p_note: " " }), "NOTE_REQUIRED");
    await rejects(mark(reception, { p_arrived: "15:30" }), "TIME_INVALID");
    await rejects(mark(reception, { p_left: "14:30" }), "TIME_INVALID");
    await rejects(mark(ozodbek, { p_arrived: "14:10" }), "FORBIDDEN");

    const day = await mark(reception, { p_arrived: "14:10" });
    expect(day).toMatchObject({ status: "here", arrive_manual_by: "Reception Test", is_late: true });
    expect(await callAs(db, ozodbek, "support_presence")).toBe(true);
    await rejects(mark(reception, { p_arrived: "14:00" }), "ATTENDANCE_ALREADY_SET");
    await rejects(mark(reception, { p_left: "14:05" }), "TIME_INVALID");

    const fixed = await mark(admin, { p_arrived: "14:00", p_note: "Was at the door at 14:00" });
    expect(fixed).toMatchObject({ is_late: false, arrive_manual_by: "Developer Test" });
    const left = await mark(reception, { p_left: "14:50" });
    expect(left).toMatchObject({ status: "done", leave_manual_by: "Reception Test" });
    expect(await callAs(db, ozodbek, "support_presence")).toBe(false);
    const audit = await db.query("select action from public.audit_log where action = 'attendance.mark'");
    expect(audit.rows).toHaveLength(3);
  });

  it("lets staff excuse a day with a note, and an excused day is not reported as missed", async () => {
    await enable();
    await db.query("select public.run_maintenance()");
    const excuse = (args) => callAs(db, reception, "staff_excuse", {
      p_support: ozodbek, p_date: "2030-01-07", p_excused: true, p_note: "Ill", ...args,
    });
    await rejects(excuse({ p_note: "" }), "NOTE_REQUIRED");
    await rejects(callAs(db, ozodbek, "staff_excuse", {
      p_support: ozodbek, p_date: "2030-01-07", p_excused: true, p_note: "Ill",
    }), "FORBIDDEN");
    expect(await excuse({})).toMatchObject({ status: "excused", excuse_note: "Ill", excused_by: "Reception Test" });

    await setNow(at("2030-01-07", "18:00"));
    await db.query("select public.run_maintenance()");
    const absent = (await notificationsOf(admin)).filter((n) => n.type === "staff_absent");
    expect(absent.map((n) => n.title)).toEqual(["Malika Test did not come"]);
    expect(await notificationsOf(ozodbek)).toEqual([]);
    expect((await excuse({ p_excused: false })).status).toBe("absent");
  });

  it("shows teachers only their own days, and the report only to staff", async () => {
    await enable();
    await checkIn(ozodbek, OZODBEK, "13:58");
    await setNow(at("2030-01-08", "10:00"));
    const mine = await callAs(db, ozodbek, "my_staff_attendance");
    expect(mine).toMatchObject({ enabled: true, face_set: true });
    expect(mine.today.status).toBe("waiting");
    expect(mine.days.map((d) => d.work_date)).toEqual(["2030-01-07"]);
    expect((await callAs(db, malika, "my_staff_attendance")).days).toEqual([]);
    await rejects(callAs(db, aziza, "my_staff_attendance"), "FORBIDDEN");
    await rejects(callAs(db, ozodbek, "staff_attendance_list", { p_from: "2030-01-07", p_to: "2030-01-07" }), "FORBIDDEN");
    expect(await callAs(db, reception, "staff_attendance_list", { p_from: "2030-01-01", p_to: "2030-01-31" }))
      .toHaveLength(1);
    expect(await callAs(db, reception, "staff_attendance_list")).toEqual([]);
    await setNow(at("2030-01-07", "20:00"));
    expect(await callAs(db, reception, "staff_attendance_list")).toHaveLength(1);
    await rejects(callAs(db, reception, "staff_attendance_list", { p_from: "2030-01-01", p_to: "2030-06-01" }), "RANGE_INVALID");
  });

  it("replaces the I'm at the center button with the scan", async () => {
    await callAs(db, ozodbek, "set_at_center", { p_present: true });
    expect(await callAs(db, ozodbek, "support_presence")).toBe(true);
    await enable();
    await rejects(callAs(db, ozodbek, "set_at_center", { p_present: false }), "ATTENDANCE_BY_SCAN");
    expect((await callAs(db, ozodbek, "get_me")).staff_attendance).toBe(true);
  });

  it("deletes face check photos after staff_photo_days but keeps the times", async () => {
    await enable();
    await checkIn(ozodbek, OZODBEK, "13:58");
    await setNow("2030-03-09T10:00:00+05:00");
    await db.query("select public.run_maintenance()");
    const checks = await callAs(db, admin, "admin_staff_face_checks", { p_support: ozodbek, p_date: "2030-01-07" });
    expect(checks.map((c) => c.photo)).toEqual([null]);
    const [day] = await callAs(db, admin, "staff_attendance_list", { p_from: "2030-01-07", p_to: "2030-01-07" });
    expect(day.arrived_at).not.toBeNull();
  });

  it("checks the attendance settings", async () => {
    const save = (key, value) => callAs(db, admin, "admin_save_setting", { p_key: key, p_value: JSON.stringify(value) });
    await rejects(save("staff_gps_radius", 10), "SETTING_INVALID");
    await rejects(save("staff_face_match", 99), "SETTING_INVALID");
    await rejects(save("staff_center_location", "the center"), "SETTING_INVALID");
    await rejects(save("staff_center_location", "140.1, 71.7"), "SETTING_INVALID");
    await save("staff_center_location", "40.3864,71.7864");
    const { rows } = await db.query("select value from public.settings where key = 'staff_center_location'");
    expect(rows[0].value).toBe("40.3864, 71.7864");
    await save("staff_center_location", "");
  });
});
