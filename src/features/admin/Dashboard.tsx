import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  Spinner,
} from "../../components/ui";
import { rpc } from "../../lib/api";
import { useMe } from "../../app/auth";
import { formatDateTime, formatDay, formatTime } from "../../lib/format";
import type { Booking } from "../../lib/types";
import { PushCard } from "../notifications/PushCard";
import { downloadWorkbook } from "./excel";
import {
  BookingRow,
  Cell,
  markBooking,
  StatTile,
  Table,
  useAction,
} from "./shared";

interface OpenComplaint {
  id: string;
  student_name: string;
  support_name: string;
  lesson_at: string;
  created_at: string;
  seen_at: string | null;
}

interface DashboardData {
  today: string;
  students: number;
  supports: number;
  upcoming_count: number;
  open_complaints: number;
  complaints: OpenComplaint[];
  mark_after_minutes: number;
  auto_no_show: boolean;
  lessons_today: Booking[];
  unmarked: Booking[];
  waiting_transfer: Booking[];
  active_bans: {
    id: string;
    student_id: string;
    student_name: string;
    ends_at: string;
  }[];
}

interface WaitRow {
  id: string;
  student_name: string;
  support_name: string;
  starts_at: string;
}

type Mark = "attended" | "no_show" | "support_absent";

interface Task {
  key: string;
  due: number;
  tone: "bad" | "warn" | "brand";
  badge: string;
  title: string;
  detail: string;
  action: ReactNode;
}

const a = (text: string, vars?: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    String(vars?.[name] ?? whole),
  );

const HEAD = [a("Time"), a("Status"), a("Student"), a("Support"), a("Topic")];
const MARKS: Mark[] = ["attended", "no_show", "support_absent"];

function TodayQueue({ data }: { data: DashboardData }) {
  const canManage = useMe().role === "admin";
  const [marking, setMarking] = useState<{
    booking: Booking;
    status: Mark;
  } | null>(null);
  const mark = useAction(
    ({ id, status }: { id: string; status: Mark }) => markBooking(id, status),
    a("Saved."),
  );
  const label: Record<Mark, string> = {
    attended: a("Came"),
    no_show: a("Missed"),
    support_absent: a("Support absent"),
  };
  const now = Date.now();

  const lessons: Task[] = data.unmarked.map((booking) => {
    const deadline =
      new Date(booking.ends_at).getTime() + data.mark_after_minutes * 60_000;
    const late = booking.status === "unmarked" || deadline <= now;
    const when = formatDateTime(booking.starts_at);
    return {
      key: booking.id,
      due: late ? 0 : deadline,
      tone: late ? "bad" : "warn",
      badge: late
        ? a("Overdue")
        : a("Mark by {time}", {
            time: formatTime(new Date(deadline).toISOString()),
          }),
      title: a("Mark the lesson: {student} with {support}", {
        student: booking.student_name,
        support: booking.support_name,
      }),
      detail: late
        ? a(
            "{when}. The support teacher can no longer mark it, so only you can.",
            { when },
          )
        : data.auto_no_show
          ? a(
              "{when}. If nobody marks it in time, it becomes a no-show and the student gets a penalty.",
              { when },
            )
          : a(
              "{when}. If nobody marks it in time, it stays unmarked and waits for you.",
              { when },
            ),
      action: canManage ? (
        <div className="flex flex-wrap gap-2">
          {MARKS.map((status) => (
            <Button
              key={status}
              size="sm"
              variant="secondary"
              onClick={() => setMarking({ booking, status })}
            >
              {label[status]}
            </Button>
          ))}
        </div>
      ) : (
        <Link to="/admin/bookings" className={buttonClass("secondary", "sm")}>
          {a("Open bookings")}
        </Link>
      ),
    };
  });

  const transfers: Task[] = data.waiting_transfer.map((booking) => ({
    key: booking.id,
    due: new Date(booking.starts_at).getTime(),
    tone: "warn",
    badge: a("Before {when}", { when: formatDateTime(booking.starts_at) }),
    title: a("Find a support teacher: {student}", {
      student: booking.student_name,
    }),
    detail: a(
      "{support} closed this time. The student was offered other support teachers. If nobody takes the lesson, it is cancelled without a penalty.",
      { support: booking.support_name },
    ),
    action: (
      <Link to="/admin/bookings" className={buttonClass("secondary", "sm")}>
        {a("Open bookings")}
      </Link>
    ),
  }));

  const complaints: Task[] = data.complaints.map((complaint) => ({
    key: complaint.id,
    due: Number.MAX_SAFE_INTEGER,
    tone: "brand",
    badge: complaint.seen_at ? a("Seen") : a("New"),
    title: a("Answer a complaint: {student}", {
      student: complaint.student_name,
    }),
    detail: a(
      "About the lesson on {when} with {support}. Sent {sent}. The student can see it is still waiting.",
      {
        when: formatDateTime(complaint.lesson_at),
        support: complaint.support_name,
        sent: formatDateTime(complaint.created_at),
      },
    ),
    action: (
      <Link to="/admin/complaints" className={buttonClass("secondary", "sm")}>
        {a("Answer")}
      </Link>
    ),
  }));

  const tasks = [...lessons, ...transfers]
    .sort((left, right) => left.due - right.due)
    .concat(complaints);

  return (
    <section aria-label={a("Do today")} className="mb-4">
      <SectionTitle>
        {a("Do today")} ({tasks.length})
      </SectionTitle>
      {tasks.length === 0 ? (
        <Card>
          <p className="text-muted">{a("Nothing needs you right now.")}</p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.key}>
              <Card>
                <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{task.title}</p>
                  <Badge tone={task.tone}>{task.badge}</Badge>
                </div>
                <p className="mb-3 text-sm text-muted">{task.detail}</p>
                {task.action}
              </Card>
            </li>
          ))}
        </ol>
      )}
      {marking && (
        <ConfirmDialog
          title={a('Mark as "{choice}"?', { choice: label[marking.status] })}
          body={a(
            "{student}, {when}, with {support}. The student and the support teacher see this, and it is saved in the activity log.",
            {
              student: marking.booking.student_name,
              when: formatDateTime(marking.booking.starts_at),
              support: marking.booking.support_name,
            },
          )}
          loading={mark.isPending}
          onConfirm={() =>
            mark.mutate(
              { id: marking.booking.id, status: marking.status },
              { onSettled: () => setMarking(null) },
            )
          }
          onClose={() => setMarking(null)}
        />
      )}
    </section>
  );
}

export function Dashboard() {
  const canManage = useMe().role === "admin";
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => rpc<DashboardData>("admin_dashboard"),
    refetchInterval: 30_000,
  });

  const waitlist = useQuery({
    queryKey: ["admin-waitlist"],
    queryFn: () => rpc<WaitRow[]>("admin_waitlist"),
  });
  const removeWait = useAction(
    (id: string) => rpc("admin_remove_waitlist", { p_id: id }),
    a("Removed."),
  );

  const download = useAction(async () => {
    const lists =
      await rpc<Record<string, Record<string, unknown>[]>>("admin_export");
    await downloadWorkbook(`opus-all-data-${data?.today}.xlsx`, lists);
  }, a("Downloaded."));

  if (isPending) return <Spinner />;
  if (isError) return <ErrorState onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={a("Dashboard")}
        subtitle={formatDay(data.today)}
        action={
          <Button
            variant="secondary"
            loading={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download className="size-4" aria-hidden />
            {a("Download all data")}
          </Button>
        }
      />
      <div className="mb-3 empty:hidden">
        <PushCard />
      </div>
      <TodayQueue data={data} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={a("Lessons today")}
          value={data.lessons_today.length}
        />
        <StatTile label={a("Upcoming bookings")} value={data.upcoming_count} />
        <StatTile label={a("Active students")} value={data.students} />
        <StatTile label={a("Support teachers")} value={data.supports} />
      </div>

      <SectionTitle>{a("Today")}</SectionTitle>
      {data.lessons_today.length === 0 ? (
        <EmptyState title={a("No lessons today")} />
      ) : (
        <Table head={HEAD}>
          {data.lessons_today.map((booking) => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </Table>
      )}

      {waitlist.data && waitlist.data.length > 0 && (
        <>
          <SectionTitle>
            {a("Waiting list (")}
            {waitlist.data.length})
          </SectionTitle>
          <Table head={[a("Time"), a("Student"), a("Support"), ""]}>
            {waitlist.data.map((row) => (
              <tr key={row.id}>
                <Cell className="whitespace-nowrap">
                  {formatDateTime(row.starts_at)}
                </Cell>
                <Cell className="font-medium">{row.student_name}</Cell>
                <Cell>{row.support_name}</Cell>
                {canManage && (
                  <Cell>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => removeWait.mutate(row.id)}
                    >
                      {a("Remove")}
                    </Button>
                  </Cell>
                )}
              </tr>
            ))}
          </Table>
        </>
      )}

      {data.active_bans.length > 0 && (
        <>
          <SectionTitle>
            {a("Banned now (")}
            {data.active_bans.length})
          </SectionTitle>
          <Table head={[a("Student"), a("Until")]}>
            {data.active_bans.map((ban) => (
              <tr key={ban.id}>
                <Cell>
                  <Link
                    to={`/admin/users/${ban.student_id}`}
                    className="font-medium hover:underline"
                  >
                    {ban.student_name}
                  </Link>
                </Cell>
                <Cell>{formatDateTime(ban.ends_at)}</Cell>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
