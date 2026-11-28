import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Stars,
} from "../../components/ui";
import { rpc } from "../../lib/api";
import { useMe } from "../../app/auth";
import { formatDateTime } from "../../lib/format";
import { useAction } from "./shared";

interface Review {
  id: string;
  rating: number;
  comment: string;
  is_hidden: boolean;
  student_name: string;
  support_name: string;
  created_at: string;
}

function EditReview({
  review,
  onClose,
}: {
  review: Review;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment);
  const save = useAction(async () => {
    await rpc("admin_update_review", {
      p_review: review.id,
      p_rating: rating,
      p_comment: comment,
    });
    onClose();
  }, "Saved.");

  return (
    <Modal title="Edit review" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Stars value={rating} onChange={setRating} size="lg" />
        <Field label="Comment">
          {(id, className) => (
            <textarea
              id={id}
              rows={3}
              className={`${className} py-2`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

export function Reviews() {
  const canManage = useMe().role === "admin";
  const [limit, setLimit] = useState(300);
  const [editing, setEditing] = useState<Review | null>(null);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-reviews", limit],
    queryFn: () => rpc<Review[]>("admin_reviews", { p_limit: limit }),
  });
  const hide = useAction(({ id, hidden }: { id: string; hidden: boolean }) =>
    rpc("admin_set_review_hidden", { p_review: id, p_hidden: hidden }),
  );
  const remove = useAction(
    (id: string) => rpc("admin_delete_review", { p_review: id }),
    "Deleted.",
  );

  if (isPending) return <Spinner />;
  if (isError) return <ErrorState onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="Hidden reviews do not count toward a support teacher's rating."
      />
      {data.length === 0 && <EmptyState title="No reviews yet" />}
      <ul className="flex flex-col gap-2">
        {data.map((review) => (
          <li key={review.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-medium">{review.student_name}</span>
                  <span className="text-muted">
                    {" "}
                    about {review.support_name}
                  </span>
                </p>
                <Stars value={review.rating} />
              </div>
              {review.comment && <p className="mt-1">{review.comment}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">
                  {formatDateTime(review.created_at)}
                </span>
                {review.is_hidden && <Badge tone="warn">Hidden</Badge>}
                {canManage && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing(review)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        hide.mutate({
                          id: review.id,
                          hidden: !review.is_hidden,
                        })
                      }
                    >
                      {review.is_hidden ? "Show" : "Hide"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => remove.mutate(review.id)}
                    >
                      Delete
                    </Button>
                  </span>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data.length >= limit && (
        <Button
          variant="secondary"
          block
          className="mt-3"
          onClick={() => setLimit(limit + 300)}
        >
          Show more
        </Button>
      )}
      {editing && (
        <EditReview review={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
