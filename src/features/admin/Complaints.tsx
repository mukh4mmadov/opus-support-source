import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Spinner,
  StatusBadge,
} from "../../components/ui";
import { rpc } from "../../lib/api";
import { useMe } from "../../app/auth";
import { formatDateTime } from "../../lib/format";
import type { Booking } from "../../lib/types";
import { markBooking, useAction } from "./shared";

interface Complaint {
  id: string;
  body: string;
  reply: string;
  answered_at: string | null;
  seen_at: string | null;
  created_at: string;
  booking: Booking;
}

function Answer({ complaint }: { complaint: Complaint }) {
  const [reply, setReply] = useState("");
  const send = useAction(
    () =>
      rpc("admin_answer_complaint", {
        p_complaint: complaint.id,
        p_reply: reply,
      }),
    "Answer sent.",
  );
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Field label="Your answer">
        {(id, className) => (
          <textarea
            id={id}
            rows={2}
            maxLength={1000}
            className={`${className} py-2`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
        )}
      </Field>
      <Button
        disabled={reply.trim() === ""}
        loading={send.isPending}
        onClick={() => send.mutate()}
      >
        Send answer
      </Button>
    </div>
  );
}

export function Complaints() {
  const canManage = useMe().role === "admin";
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-complaints"],
    queryFn: () => rpc<Complaint[]>("admin_complaints"),
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    rpc("admin_complaints_seen")
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      )
      .catch(() => undefined);
  }, [queryClient]);
  const attended = useAction(
    (booking: string) => markBooking(booking, "attended"),
    "Marked as attended.",
  );
  const remove = useAction(
    (id: string) => rpc("admin_delete_complaint", { p_complaint: id }),
    "Deleted.",
  );

  if (isPending) return <Spinner />;
  if (isError) return <ErrorState onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Complaints"
        subtitle="Students write these about a lesson. Support teachers never see them."
      />
      {data.length === 0 && <EmptyState title="No complaints" />}
      <ul className="flex flex-col gap-3">
        {data.map((complaint) => (
          <li key={complaint.id}>
            <Card>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={complaint.answered_at ? "ok" : "warn"}>
                  {complaint.answered_at
                    ? "Answered"
                    : complaint.seen_at
                      ? "Seen"
                      : "New"}
                </Badge>
                <StatusBadge status={complaint.booking.status} />
                <span className="text-sm text-muted">
                  {formatDateTime(complaint.booking.starts_at)}
                </span>
              </div>
              <p className="mb-2 text-sm text-muted">
                <Link
                  to={`/admin/users/${complaint.booking.student_id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {complaint.booking.student_name}
                </Link>
                {" about "}
                <Link
                  to={`/admin/users/${complaint.booking.support_id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {complaint.booking.support_name}
                </Link>
              </p>
              <p className="whitespace-pre-line">{complaint.body}</p>
              {complaint.answered_at ? (
                <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm">
                  {complaint.reply}
                </p>
              ) : (
                <Answer complaint={complaint} />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage && complaint.booking.status === "no_show" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => attended.mutate(complaint.booking.id)}
                  >
                    Mark as attended
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(complaint.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
