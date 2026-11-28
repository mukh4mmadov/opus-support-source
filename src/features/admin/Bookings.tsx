import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, MessageCircle, Pencil, Plus } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { useText } from "../../app/config";
import { useMe } from "../../app/auth";
import { rpc } from "../../lib/api";
import {
  addDays,
  formatDateTime,
  formatTime,
  todayInTashkent,
} from "../../lib/format";
import type { AdminUser, Booking, BookingStatus, Slot } from "../../lib/types";
import { downloadExcel } from "./excel";
import { BookingRow, markBooking, Table, useAction } from "./shared";

const STATUSES: BookingStatus[] = [
  "booked",
  "needs_transfer",
  "attended",
  "no_show",
  "excused",
  "cancelled",
  "support_absent",
  "unmarked",
];

function NewBooking({ onClose }: { onClose: () => void }) {
  const [student, setStudent] = useState("");
  const [support, setSupport] = useState("");
  const [day, setDay] = useState(addDays(todayInTashkent(), 1));
  const [slot, setSlot] = useState("");
  const [topic, setTopic] = useState("");

  const users = useQuery({
    queryKey: ["admin-users", "all"],
    queryFn: () => rpc<AdminUser[]>("admin_list_users"),
  });
  const slots = useQuery({
    queryKey: ["slots", support, day],
    queryFn: () =>
      rpc<Slot[]>("support_slots", { p_support: support, p_date: day }),
    enabled: Boolean(support && day),
  });

  const book = useAction(async () => {
    await rpc("book_lesson", {
      p_support: support,
      p_starts_at: slot,
      p_topic: topic,
      p_student: student,
    });
    onClose();
  }, "Booked.");

  const people = (role: string) =>
    users.data?.filter((user) => user.role === role && user.is_active) ?? [];
  const free = slots.data?.filter((item) => item.is_free) ?? [];

  return (
    <Modal title="Book for a student" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          The admin can skip a student's limits and bans. Taken or closed times
          stay unavailable.
        </p>
        <Field label="Student">
          {(id, className) => (
            <select
              id={id}
              className={`${className} h-11`}
              value={student}
              onChange={(event) => setStudent(event.target.value)}
            >
              <option value="">Choose</option>
              {people("student").map((user) => (
                <option key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Support teacher">
          {(id, className) => (
            <select
              id={id}
              className={`${className} h-11`}
              value={support}
              onChange={(event) => {
                setSupport(event.target.value);
                setSlot("");
              }}
            >
              <option value="">Choose</option>
              {people("support").map((user) => (
                <option key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Date">
          {(id, className) => (
            <input
              id={id}
              type="date"
              className={`${className} h-11`}
              value={day}
              onChange={(event) => {
                setDay(event.target.value);
                setSlot("");
              }}
            />
          )}
        </Field>
        <Field label="Time">
          {(id, className) => (
            <select
              id={id}
              className={`${className} h-11`}
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
            >
              <option value="">
                {support
                  ? `${free.length} free`
                  : "Choose a support teacher first"}
              </option>
              {free.map((item) => (
                <option key={item.starts_at} value={item.starts_at}>
                  {formatTime(item.starts_at)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Topic">
          {(id, className) => (
            <input
              id={id}
              className={`${className} h-11`}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          )}
        </Field>
        <Button
          disabled={!student || !slot}
          loading={book.isPending}
          onClick={() => book.mutate()}
        >
          Book lesson
        </Button>
      </div>
    </Modal>
  );
}

function EditBooking({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const active =
    booking.status === "booked" || booking.status === "needs_transfer";
  const [topic, setTopic] = useState(booking.topic);
  const [support, setSupport] = useState(booking.support_id);
  const [day, setDay] = useState(booking.lesson_date);
  const [slot, setSlot] = useState("");
  const [deleting, setDeleting] = useState(false);

  const supports = useQuery({
    queryKey: ["admin-users", "support", ""],
    queryFn: () =>
      rpc<AdminUser[]>("admin_list_users", { p_role: "support", p_search: "" }),
  });
  const slots = useQuery({
    queryKey: ["slots", support, day],
    queryFn: () =>
      rpc<Slot[]>("support_slots", { p_support: support, p_date: day }),
    enabled: active,
  });

  const saveTopic = useAction(async () => {
    await rpc("admin_update_booking", {
      p_booking: booking.id,
      p_topic: topic,
    });
    onClose();
  }, "Saved.");
  const move = useAction(async () => {
    await rpc("admin_move_booking", {
      p_booking: booking.id,
      p_support: support,
      p_starts_at: slot,
    });
    onClose();
  }, "Lesson moved.");
  const remove = useAction(async () => {
    await rpc("admin_delete_booking", { p_booking: booking.id });
    onClose();
  }, "Lesson deleted.");

  const free = slots.data?.filter((item) => item.is_free) ?? [];

  return (
    <Modal
      title={`${booking.student_name}, ${formatDateTime(booking.starts_at)}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Field label="Topic">
          {(id, className) => (
            <textarea
              id={id}
              rows={2}
              className={`${className} py-2`}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          )}
        </Field>
        <Button
          variant="secondary"
          loading={saveTopic.isPending}
          onClick={() => saveTopic.mutate()}
        >
          Save topic
        </Button>

        {active && (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <p className="font-semibold">Move this lesson</p>
            <Field label="Support teacher">
              {(id, className) => (
                <select
                  id={id}
                  className={`${className} h-11`}
                  value={support}
                  onChange={(event) => {
                    setSupport(event.target.value);
                    setSlot("");
                  }}
                >
                  {supports.data
                    ?.filter((user) => user.is_active)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.first_name} {user.last_name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Date">
              {(id, className) => (
                <input
                  id={id}
                  type="date"
                  className={`${className} h-11`}
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    setSlot("");
                  }}
                />
              )}
            </Field>
            <Field label="New time">
              {(id, className) => (
                <select
                  id={id}
                  className={`${className} h-11`}
                  value={slot}
                  onChange={(event) => setSlot(event.target.value)}
                >
                  <option value="">{free.length} free</option>
                  {free.map((item) => (
                    <option key={item.starts_at} value={item.starts_at}>
                      {formatTime(item.starts_at)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              disabled={!slot}
              loading={move.isPending}
              onClick={() => move.mutate()}
            >
              Move lesson
            </Button>
          </div>
        )}

        <div className="border-t border-line pt-3">
          <Button variant="danger" block onClick={() => setDeleting(true)}>
            Delete from history
          </Button>
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete from history"
          body="This lesson disappears from every list and statistic. To keep the record, cancel it instead."
          confirmLabel="Delete forever"
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}

function SetStatus({ booking }: { booking: Booking }) {
  const t = useText();
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const mark = useAction(
    (status: string) => markBooking(booking.id, status),
    "Saved.",
  );
  const cancel = useAction(
    () => rpc("cancel_booking", { p_booking: booking.id }),
    "Cancelled.",
  );

  const active =
    booking.status === "booked" || booking.status === "needs_transfer";

  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="secondary"
        aria-label="Edit lesson"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Link
        to={`/chat/${booking.id}`}
        aria-label="Open chat"
        className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface hover:bg-sunken"
      >
        <MessageCircle className="size-4" aria-hidden />
      </Link>
      {booking.status !== "needs_transfer" &&
        booking.status !== "cancelled" && (
          <select
            aria-label="Set attendance"
            className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
            value=""
            onChange={(event) =>
              event.target.value && mark.mutate(event.target.value)
            }
          >
            <option value="">Set</option>
            {(["attended", "no_show", "excused", "support_absent"] as const)
              .filter((status) => status !== booking.status)
              .map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
          </select>
        )}
      {active && (
        <Button size="sm" variant="danger" onClick={() => setCancelling(true)}>
          Cancel
        </Button>
      )}
      {editing && (
        <EditBooking booking={booking} onClose={() => setEditing(false)} />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel lesson"
          body={`Cancel ${booking.student_name}'s lesson on ${formatDateTime(booking.starts_at)}? Both sides will be told.`}
          danger
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate()}
          onClose={() => setCancelling(false)}
        />
      )}
    </div>
  );
}

export function Bookings() {
  const canManage = useMe().role === "admin";
  const t = useText();
  const today = todayInTashkent();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 7));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [support, setSupport] = useState("");
  const [limit, setLimit] = useState(200);
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-bookings", from, to, status, search, support, limit],
    queryFn: () =>
      rpc<Booking[]>("admin_bookings", {
        p_from: from,
        p_to: to,
        p_search: search,
        p_limit: limit,
        ...(status ? { p_status: status } : {}),
        ...(support ? { p_support: support } : {}),
      }),
  });
  const supports = useQuery({
    queryKey: ["admin-users", "support", ""],
    queryFn: () =>
      rpc<AdminUser[]>("admin_list_users", { p_role: "support", p_search: "" }),
  });

  const control = "h-10 rounded-lg border border-line bg-surface px-2";

  return (
    <>
      <PageHeader
        title="Bookings"
        action={
          <div className="flex gap-2">
            {data && (
              <Button
                variant="secondary"
                aria-label="Export"
                onClick={() =>
                  downloadExcel(
                    "opus-bookings.xlsx",
                    ["Date", "Time", "Student", "Support", "Topic", "Status"],
                    data.map((booking) => [
                      booking.lesson_date,
                      formatTime(booking.starts_at),
                      booking.student_name,
                      booking.support_name,
                      booking.topic,
                      t(`status.${booking.status}`),
                    ]),
                  )
                }
              >
                <Download className="size-4" aria-hidden />
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden /> Book
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          aria-label="From"
          type="date"
          className={control}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <input
          aria-label="To"
          type="date"
          className={control}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <select
          aria-label="Status"
          className={control}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((item) => (
            <option key={item} value={item}>
              {t(`status.${item}`)}
            </option>
          ))}
        </select>
        <select
          aria-label="Support teacher"
          className={control}
          value={support}
          onChange={(event) => setSupport(event.target.value)}
        >
          <option value="">All support teachers</option>
          {supports.data?.map((user) => (
            <option key={user.id} value={user.id}>
              {user.first_name} {user.last_name}
            </option>
          ))}
        </select>
        <input
          aria-label="Student"
          placeholder="Student name"
          className={`${control} min-w-40 flex-1`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.length === 0 && <EmptyState title="No bookings in this range" />}
      {data && data.length > 0 && (
        <Table
          head={[
            "Time",
            "Status",
            "Student",
            "Support",
            "Topic",
            ...(canManage ? [""] : []),
          ]}
        >
          {data.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              actions={canManage ? <SetStatus booking={booking} /> : undefined}
            />
          ))}
        </Table>
      )}
      {data && data.length >= limit && (
        <Button
          variant="secondary"
          block
          className="mt-3"
          onClick={() => setLimit(limit + 200)}
        >
          Show more
        </Button>
      )}
      {creating && <NewBooking onClose={() => setCreating(false)} />}
    </>
  );
}
