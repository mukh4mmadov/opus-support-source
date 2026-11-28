import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogIn, Plus, Trash2 } from "lucide-react";
import {
  BackLink,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Notice,
  PageHeader,
  RatingLine,
  SectionTitle,
  Spinner,
  Stars,
} from "../../components/ui";
import { signInAs, useMe } from "../../app/auth";
import { adminUsers, rpc } from "../../lib/api";
import { formatDateTime, formatDay, WEEKDAYS } from "../../lib/format";
import type {
  AttendanceSummary as AttendanceSummaryData,
  Booking,
  Credentials,
  Rating,
  Role,
  ScheduleRow,
} from "../../lib/types";
import { AttendanceChart, type SeriesRow } from "../history/AttendanceChart";
import { AttendanceSummary } from "../history/AttendanceSummary";
import { WeekView } from "../support/SupportCalendar";
import { FacePhotoCard } from "../attendance/FacePhoto";
import { BookingRow, Cell, Table, useAction } from "./shared";
import { CredentialsCard } from "./Users";
import {
  AffectedLessons,
  type AffectedLesson,
} from "../../components/AffectedLessons";

interface Detail {
  profile: {
    id: string;
    role: Role;
    login: string;
    first_name: string;
    last_name: string;
    birth_year: number | null;
    bio: string;
    phone: string;
    is_active: boolean;
    archived_at: string | null;
    password_changed_at: string | null;
    must_change_password: boolean;
  };
  bookings: Booking[];
  penalties: {
    id: string;
    kind: string;
    note: string;
    created_at: string;
    revoked_at: string | null;
  }[];
  reviews: {
    id: string;
    rating: number;
    comment: string;
    is_hidden: boolean;
    student_name: string;
    support_name: string;
    created_at: string;
  }[];
  chats: {
    booking_id: string;
    student_name: string;
    support_name: string;
    starts_at: string;
    messages: number;
  }[];
  bans: {
    id: string;
    starts_at: string;
    ends_at: string;
    reason: string;
    lifted_at: string | null;
  }[];
  strikes: number;
  schedule: ScheduleRow[];
  rating: Rating;
}

interface Extras {
  push_devices: number;
  rebook_from: string | null;
  hidden_from_top: boolean;
}

function AccessCard({ id, isStudent }: { id: string; isStudent: boolean }) {
  const { data } = useQuery({
    queryKey: ["admin-extras", id],
    queryFn: () => rpc<Extras>("admin_user_extras", { p_user: id }),
  });
  const open = useAction(
    () => rpc("admin_clear_rebook", { p_student: id }),
    "Booking is open.",
  );
  const hide = useAction(
    (hidden: boolean) =>
      rpc("admin_set_ranking_hidden", { p_user: id, p_hidden: hidden }),
    "Saved.",
  );
  const isDeveloper = useMe().role === "admin";
  if (!data) return null;
  return (
    <Card className="mt-3">
      <div className="flex flex-col gap-3">
        <p>
          <span className="text-muted">Notifications: </span>
          {data.push_devices > 0
            ? `on, ${data.push_devices} device(s)`
            : "off on every device"}
        </p>
        {isStudent && data.rebook_from && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p>
                <span className="text-muted">Can book again from: </span>
                {formatDay(data.rebook_from)}, 00:00
              </p>
              {isDeveloper && (
                <p className="text-sm text-muted">
                  Open booking now removes the wait after cancelling. The
                  student can book at once, with the usual rules.
                </p>
              )}
            </div>
            {isDeveloper && (
              <Button
                size="sm"
                variant="secondary"
                loading={open.isPending}
                onClick={() => open.mutate()}
              >
                Open booking now
              </Button>
            )}
          </div>
        )}
        {isStudent && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <span className="text-muted">Top students: </span>
              {data.hidden_from_top ? "hidden" : "shown"}
            </p>
            {isDeveloper && (
              <Button
                size="sm"
                variant="secondary"
                loading={hide.isPending}
                onClick={() => hide.mutate(!data.hidden_from_top)}
              >
                {data.hidden_from_top ? "Show in ranking" : "Hide from ranking"}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function EditForm({ detail }: { detail: Detail }) {
  const managerViewer = useMe().role === "manager";
  const { profile } = detail;
  const [first, setFirst] = useState(profile.first_name);
  const [last, setLast] = useState(profile.last_name);
  const [year, setYear] = useState(profile.birth_year?.toString() ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [phone, setPhone] = useState(profile.phone);

  const save = useAction(
    () =>
      rpc("admin_update_user", {
        p_user: profile.id,
        p_first: first,
        p_last: last,
        p_birth_year: year ? Number(year) : null,
        p_bio: bio,
        p_active: profile.is_active,
        p_phone: phone,
      }),
    "Saved.",
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <Field label="First name">
        {(id, className) => (
          <input
            id={id}
            required
            className={`${className} h-11`}
            value={first}
            onChange={(event) => setFirst(event.target.value)}
          />
        )}
      </Field>
      <Field label="Last name">
        {(id, className) => (
          <input
            id={id}
            required
            className={`${className} h-11`}
            value={last}
            onChange={(event) => setLast(event.target.value)}
          />
        )}
      </Field>
      {profile.role !== "support" && (
        <Field label="Birth year">
          {(id, className) => (
            <input
              id={id}
              type="number"
              className={`${className} h-11`}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          )}
        </Field>
      )}
      <Field
        label="Phone"
        hint={
          profile.role === "support"
            ? "Shown only to a student who has a lesson with this support teacher."
            : undefined
        }
      >
        {(id, className) => (
          <input
            id={id}
            type="tel"
            maxLength={30}
            className={`${className} h-11`}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>
      {profile.role === "support" && !managerViewer && (
        <div className="sm:col-span-3">
          <Field label="About (shown to students)">
            {(id, className) => (
              <textarea
                id={id}
                rows={2}
                className={`${className} py-2`}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      <div className="sm:col-span-3">
        <Button type="submit" loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function ScheduleEditor({
  support,
  schedule,
}: {
  support: string;
  schedule: ScheduleRow[];
}) {
  const [rows, setRows] = useState(schedule);
  const [affected, setAffected] = useState<AffectedLesson[] | null>(null);
  const check = useAction(async () => {
    const lessons = await rpc<AffectedLesson[]>("admin_schedule_preview", {
      p_support: support,
      p_rows: rows,
    });
    if (lessons.length > 0) setAffected(lessons);
    else await save.mutateAsync();
  });
  const canMoveAffectedLessons = useMe().role === "admin";
  const save = useAction(
    () => rpc("admin_set_schedule", { p_support: support, p_rows: rows }),
    "Schedule saved.",
  );

  const update = (index: number, change: Partial<ScheduleRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const applyWorkdays = () =>
    setRows(
      [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        start_time: "14:00",
        end_time: "18:00",
      })),
    );

  const invalid = rows.some((row) => row.end_time <= row.start_time);
  const field = "h-9 rounded-lg border border-line bg-surface px-2";

  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Day"
              className={field}
              value={row.weekday}
              onChange={(event) =>
                update(index, { weekday: Number(event.target.value) })
              }
            >
              {WEEKDAYS.map((name, day) => (
                <option key={name} value={day + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              aria-label="From"
              type="time"
              className={field}
              value={row.start_time}
              onChange={(event) =>
                update(index, { start_time: event.target.value })
              }
            />
            <span className="text-muted">to</span>
            <input
              aria-label="To"
              type="time"
              className={field}
              value={row.end_time}
              onChange={(event) =>
                update(index, { end_time: event.target.value })
              }
            />
            <button
              type="button"
              aria-label="Remove"
              className="rounded-md p-2 text-muted hover:bg-sunken"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {invalid && (
        <p className="mt-2 text-sm text-bad">
          The end time must be after the start time.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setRows([
              ...rows,
              { weekday: 1, start_time: "14:00", end_time: "18:00" },
            ])
          }
        >
          <Plus className="size-4" aria-hidden /> Add hours
        </Button>
        {rows.length === 0 && (
          <Button size="sm" variant="secondary" onClick={applyWorkdays}>
            Mon-Fri 14:00-18:00
          </Button>
        )}
        <Button
          size="sm"
          disabled={invalid}
          loading={check.isPending || save.isPending}
          onClick={() => check.mutate()}
        >
          Save schedule
        </Button>
      </div>
      {affected && canMoveAffectedLessons && (
        <ConfirmDialog
          title={"Save new hours?"}
          body={"These booked lessons fall outside the new hours."}
          loading={save.isPending}
          onConfirm={() =>
            save.mutate(undefined, { onSettled: () => setAffected(null) })
          }
          onClose={() => setAffected(null)}
        >
          <AffectedLessons lessons={affected} showDay />
        </ConfirmDialog>
      )}
      {affected && !canMoveAffectedLessons && (
        <Notice tone="warn" title="Ask the developer to change these hours">
          These hours affect booked lessons. You can only save schedule changes
          that leave every booking in place.
          <AffectedLessons lessons={affected} showDay />
        </Notice>
      )}
      <p className="mt-2 text-sm text-muted">
        Lessons that no longer fit are moved to another support teacher or
        cancelled, and students are told.
      </p>
    </>
  );
}

function BanForm({
  student,
  onClose,
}: {
  student: string;
  onClose: () => void;
}) {
  const [hours, setHours] = useState("24");
  const [reason, setReason] = useState("");
  const ban = useAction(async () => {
    await rpc("admin_add_ban", {
      p_student: student,
      p_hours: Number(hours),
      p_reason: reason,
    });
    onClose();
  }, "Ban added.");

  return (
    <Modal title="Ban from booking" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Hours">
          {(id, className) => (
            <input
              id={id}
              type="number"
              min={1}
              className={`${className} h-11`}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          )}
        </Field>
        <Field label="Reason">
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <Button
          disabled={Number(hours) < 1}
          loading={ban.isPending}
          onClick={() => ban.mutate()}
        >
          Add ban
        </Button>
      </div>
    </Modal>
  );
}

function WarningForm({
  student,
  onClose,
}: {
  student: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const add = useAction(async () => {
    await rpc("admin_add_warning", { p_student: student, p_note: note });
    onClose();
  }, "Warning added.");

  return (
    <Modal title="Add a warning" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          It counts as a strike and the student is told.
        </p>
        <Field label="Reason">
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Button loading={add.isPending} onClick={() => add.mutate()}>
          Add warning
        </Button>
      </div>
    </Modal>
  );
}

function MessageForm({ user, onClose }: { user: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const send = useAction(async () => {
    await rpc("admin_send_notice", {
      p_audience: "one",
      p_user: user,
      p_title: title,
      p_body: body,
    });
    onClose();
  }, "Message sent.");

  return (
    <Modal title="Send a message" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <Field label="Message">
          {(id, className) => (
            <textarea
              id={id}
              rows={3}
              className={`${className} py-2`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}
        </Field>
        <Button
          disabled={!title.trim() || !body.trim()}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          Send
        </Button>
      </div>
    </Modal>
  );
}

function LoginForm({
  user,
  current,
  onClose,
}: {
  user: string;
  current: string;
  onClose: () => void;
}) {
  const [login, setLogin] = useState(current);
  const save = useAction(async () => {
    await adminUsers({ action: "change_login", user_id: user, login });
    onClose();
  }, "Login changed.");

  return (
    <Modal title="Change login" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field
          label="New login"
          hint="Small letters, numbers, dots and dashes. The password stays the same."
        >
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          )}
        </Field>
        <Button
          disabled={!login.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function DeleteForever({
  name,
  loading,
  onConfirm,
  onClose,
}: {
  name: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <Modal title="Delete forever" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Notice tone="bad">
          This erases the account, every lesson, chat and review of this person,
          and changes the statistics. It cannot be undone. If they left the
          center, use Move to archive instead.
        </Notice>
        <Field label={`Type ${name} to confirm`}>
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
        <Button
          variant="danger"
          disabled={typed.trim() !== name}
          loading={loading}
          onClick={onConfirm}
        >
          Delete forever
        </Button>
      </div>
    </Modal>
  );
}

export function UserDetail() {
  const managerViewer = useMe().role === "manager";
  const { id } = useParams();
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);
  const [warning, setWarning] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [changingLogin, setChangingLogin] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lessonLimit, setLessonLimit] = useState(100);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => rpc<Detail>("admin_user_detail", { p_user: id }),
  });
  const attendance = useQuery({
    queryKey: ["admin-attendance", id],
    queryFn: () =>
      rpc<AttendanceSummaryData>("admin_attendance", { p_user: id }),
  });

  const reveal = useAction(async () => {
    setShownPassword(null);
    const result = await adminUsers<{ password: string }>({
      action: "view_password",
      user_id: id,
    });
    setShownPassword(result.password);
  });
  const reset = useAction(async () => {
    setCredentials(
      await adminUsers<Credentials>({ action: "reset_password", user_id: id }),
    );
  });
  const remove = useAction(async () => {
    await adminUsers({ action: "delete", user_id: id });
    navigate(
      data?.profile.role === "manager"
        ? "/admin/managers"
        : data?.profile.role === "support"
          ? "/admin/supports"
          : "/admin/students",
    );
  }, "Account deleted.");
  const impersonate = useAction(() => signInAs(id!));
  const archive = useAction(async (archived: boolean) => {
    await rpc("admin_set_archived", { p_user: id, p_archived: archived });
    setArchiving(false);
  }, "Saved.");
  const liftBan = useAction(
    (ban: string) => rpc("admin_lift_ban", { p_ban: ban }),
    "Ban lifted.",
  );
  const revoke = useAction(
    (penalty: string) => rpc("admin_revoke_penalty", { p_penalty: penalty }),
    "Removed.",
  );

  if (isPending) return <Spinner />;
  if (isError && error.message === "USER_NOT_FOUND") {
    return (
      <>
        <BackLink to="/admin/students" />
        <EmptyState
          title="This account no longer exists"
          hint="It was deleted. Older notifications can still point to it."
        />
      </>
    );
  }
  if (isError) return <ErrorState onRetry={refetch} />;

  const { profile } = data;
  const isStudent = profile.role === "student";
  const isSupport = profile.role === "support";
  const now = new Date();

  return (
    <>
      <BackLink
        to={
          profile.role === "manager"
            ? "/admin/managers"
            : isSupport
              ? "/admin/supports"
              : "/admin/students"
        }
      />
      {credentials && (
        <CredentialsCard
          credentials={credentials}
          manager={profile.role === "manager"}
          onClose={() => setCredentials(null)}
        />
      )}
      <PageHeader
        title={`${profile.first_name} ${profile.last_name}`}
        subtitle={profile.login}
        action={isSupport ? <RatingLine {...data.rating} /> : undefined}
      />

      {profile.archived_at && (
        <div className="mb-3">
          <Notice
            tone="warn"
            title={managerViewer ? "Inactive" : "In the archive"}
          >
            {managerViewer ? "Made inactive" : "Moved to the archive"} on{" "}
            {formatDateTime(profile.archived_at)}. This person cannot sign in
            and is hidden from the site. All their records are kept below.
          </Notice>
        </div>
      )}

      <Card>
        <EditForm key={JSON.stringify(profile)} detail={data} />
      </Card>
      {(isStudent || isSupport) && (
        <AccessCard id={profile.id} isStudent={isStudent} />
      )}

      {profile.role !== "admin" && (
        <Card className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-muted">Password</p>
              <p className="font-semibold" data-testid="shown-password">
                {shownPassword ?? "••••••••••"}
              </p>
              <p className="text-sm text-muted">
                {profile.password_changed_at
                  ? `Changed by the user on ${formatDateTime(profile.password_changed_at)}`
                  : "Not changed by the user"}
              </p>
            </div>
            {(!managerViewer || profile.must_change_password) && (
              <Button
                variant="secondary"
                loading={reveal.isPending}
                onClick={() =>
                  shownPassword ? setShownPassword(null) : reveal.mutate()
                }
              >
                {shownPassword ? "Hide password" : "Show password"}
              </Button>
            )}
            {managerViewer && !profile.must_change_password && (
              <p className="max-w-60 text-sm text-muted">
                The user changed this password. Only the developer can view or reset
                it.
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!managerViewer && profile.role !== "admin" && profile.is_active && (
          <Button
            loading={impersonate.isPending}
            onClick={() => impersonate.mutate()}
          >
            <LogIn className="size-4" aria-hidden />
            Sign in as this person
          </Button>
        )}
        {!managerViewer && (
          <Button
            variant="secondary"
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            Reset password
          </Button>
        )}
        {profile.role !== "admin" && !managerViewer && (
          <>
            <Button variant="secondary" onClick={() => setChangingLogin(true)}>
              Change login
            </Button>
            <Button variant="secondary" onClick={() => setMessaging(true)}>
              Send a message
            </Button>
          </>
        )}
        {isStudent && !managerViewer && (
          <>
            <Button variant="secondary" onClick={() => setBanning(true)}>
              Ban from booking
            </Button>
            <Button variant="secondary" onClick={() => setWarning(true)}>
              Add a warning
            </Button>
          </>
        )}
        {profile.role !== "admin" &&
          (profile.is_active ? (
            <Button variant="danger" onClick={() => setArchiving(true)}>
              {managerViewer ? "Make inactive" : "Move to archive"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              loading={archive.isPending}
              onClick={() => archive.mutate(false)}
            >
              {managerViewer ? "Make active again" : "Restore from archive"}
            </Button>
          ))}
        {profile.role !== "admin" && !managerViewer && (
          <Button variant="ghost" onClick={() => setDeleting(true)}>
            Delete forever
          </Button>
        )}
      </div>

      {isSupport && (
        <>
          <SectionTitle>Working days and hours</SectionTitle>
          <Card>
            <ScheduleEditor
              key={JSON.stringify(data.schedule)}
              support={profile.id}
              schedule={data.schedule}
            />
          </Card>
          <SectionTitle>Week</SectionTitle>
          <WeekView support={profile.id} />
          {!managerViewer && (
            <>
              <SectionTitle>Face photo for attendance</SectionTitle>
              <FacePhotoCard support={profile.id} />
            </>
          )}
        </>
      )}

      {isStudent && !managerViewer && (
        <>
          <SectionTitle>Bans ({data.bans.length})</SectionTitle>
          {data.bans.length > 0 && (
            <Table head={["From", "Until", "Reason", ""]}>
              {data.bans.map((ban) => {
                const active = !ban.lifted_at && new Date(ban.ends_at) > now;
                return (
                  <tr key={ban.id}>
                    <Cell>{formatDateTime(ban.starts_at)}</Cell>
                    <Cell>{formatDateTime(ban.ends_at)}</Cell>
                    <Cell>{ban.reason}</Cell>
                    <Cell>
                      {active ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => liftBan.mutate(ban.id)}
                        >
                          Lift
                        </Button>
                      ) : (
                        <Badge>{ban.lifted_at ? "Lifted" : "Ended"}</Badge>
                      )}
                    </Cell>
                  </tr>
                );
              })}
            </Table>
          )}
          <SectionTitle>Strikes ({data.strikes} active)</SectionTitle>
          {data.penalties.length > 0 && (
            <Table head={["Date", "Result", "Note", ""]}>
              {data.penalties.map((penalty) => (
                <tr key={penalty.id}>
                  <Cell>{formatDateTime(penalty.created_at)}</Cell>
                  <Cell>{penalty.kind === "ban" ? "Ban" : "Warning"}</Cell>
                  <Cell className="text-sm text-muted">{penalty.note}</Cell>
                  <Cell>
                    {penalty.revoked_at ? (
                      <Badge>Removed</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => revoke.mutate(penalty.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {profile.role !== "admin" && (
        <>
          <SectionTitle>Lessons ({data.bookings.length})</SectionTitle>
          {attendance.data ? (
            <AttendanceSummary
              summary={attendance.data}
              forSupport={isSupport}
              plain
            />
          ) : (
            <div className="skeleton mb-4 h-32 rounded-xl" aria-hidden />
          )}
          <div className="mb-4">
            <AttendanceChart
              cacheKey={profile.id}
              load={(unit) =>
                rpc<SeriesRow[]>("admin_attendance_series", {
                  p_user: profile.id,
                  p_unit: unit,
                })
              }
            />
          </div>
          {data.bookings.length > 0 && (
            <Table head={["Time", "Status", "Student", "Support", "Topic"]}>
              {data.bookings.slice(0, lessonLimit).map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </Table>
          )}
          {data.bookings.length > lessonLimit && (
            <Button
              variant="secondary"
              block
              className="mt-3"
              onClick={() => setLessonLimit(lessonLimit + 100)}
            >
              Show more
            </Button>
          )}

          {!managerViewer && (
            <SectionTitle>Chats ({data.chats.length})</SectionTitle>
          )}
          {!managerViewer && data.chats.length > 0 && (
            <Table head={["Lesson", "Student", "Support", "Messages", ""]}>
              {data.chats.map((chat) => (
                <tr key={chat.booking_id}>
                  <Cell className="whitespace-nowrap">
                    {formatDateTime(chat.starts_at)}
                  </Cell>
                  <Cell>{chat.student_name}</Cell>
                  <Cell>{chat.support_name}</Cell>
                  <Cell className="tabular-nums">{chat.messages}</Cell>
                  <Cell>
                    <Link
                      to={`/chat/${chat.booking_id}`}
                      className="font-medium hover:underline"
                    >
                      Read
                    </Link>
                  </Cell>
                </tr>
              ))}
            </Table>
          )}

          <SectionTitle>Reviews ({data.reviews.length})</SectionTitle>
          {data.reviews.length > 0 && (
            <ul className="flex flex-col gap-2">
              {data.reviews.map((review) => (
                <li key={review.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>
                        <span className="font-medium">
                          {review.student_name}
                        </span>
                        <span className="text-muted">
                          {" "}
                          about {review.support_name}
                        </span>
                      </p>
                      <Stars value={review.rating} />
                    </div>
                    {review.comment && <p className="mt-1">{review.comment}</p>}
                    {review.is_hidden && <Badge tone="warn">Hidden</Badge>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {banning && (
        <BanForm student={profile.id} onClose={() => setBanning(false)} />
      )}
      {warning && (
        <WarningForm student={profile.id} onClose={() => setWarning(false)} />
      )}
      {messaging && (
        <MessageForm user={profile.id} onClose={() => setMessaging(false)} />
      )}
      {changingLogin && (
        <LoginForm
          user={profile.id}
          current={profile.login}
          onClose={() => setChangingLogin(false)}
        />
      )}
      {archiving && (
        <ConfirmDialog
          title={managerViewer ? "Make inactive" : "Move to archive"}
          body={`${profile.first_name} ${profile.last_name} will not be able to sign in and will disappear from the site. Open lessons are moved or cancelled. All their records stay here, and you can restore them any time.`}
          confirmLabel={managerViewer ? "Make inactive" : "Move to archive"}
          loading={archive.isPending}
          onConfirm={() => archive.mutate(true)}
          onClose={() => setArchiving(false)}
        />
      )}
      {deleting && (
        <DeleteForever
          name={`${profile.first_name} ${profile.last_name}`}
          loading={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}
