import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Plus, Printer, Search, Upload } from "lucide-react";
import {
  Badge,
  Button,
  buttonClass,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Notice,
  PageHeader,
  RatingLine,
  Spinner,
} from "../../components/ui";
import { useConfig } from "../../app/config";
import { useMe } from "../../app/auth";
import { useToast } from "../../app/toast";
import { adminUsers, rpc } from "../../lib/api";
import { formatDateTime, scheduleLines } from "../../lib/format";
import type { AdminUser, Credentials } from "../../lib/types";
import { downloadExcel, readPeople, type ImportedPerson } from "./excel";
import { QrImage } from "../checkin/SupportQr";
import { Cell, Table, useAction } from "./shared";

export function CredentialsCard({
  credentials,
  onClose,
  manager = false,
}: {
  credentials: Credentials;
  onClose: () => void;
  manager?: boolean;
}) {
  const { settings } = useConfig();
  const toast = useToast();
  const text = `${settings.center_name}\nSite: ${location.origin}\nLogin: ${credentials.login}\nPassword: ${credentials.password}`;

  return (
    <Modal
      title={credentials.existing ? "Already has an account" : "Login details"}
      onClose={onClose}
    >
      {credentials.existing ? (
        <div className="mb-3">
          <Notice tone="warn">
            This person is already registered with the same name and birth year,
            so no new account was made.{" "}
            {manager
              ? "Only the developer can view or reset their password."
              : "These are the login details they have now."}
            {credentials.archived && (
              <> They are in the archive. Open their page to restore them.</>
            )}
          </Notice>
        </div>
      ) : manager ? (
        <p className="mb-3 text-muted">
          This password is issued by the developer. The second-level admin cannot
          change it; only the developer can reset it.
        </p>
      ) : (
        <p className="mb-3 text-muted">
          The password is the same as the login. The first time they sign in,
          they must choose their own.
        </p>
      )}
      <div className="print-card mb-4 flex gap-4 rounded-lg bg-sunken p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{settings.center_name}</p>
          {credentials.first_name && (
            <p>
              {credentials.first_name} {credentials.last_name}
            </p>
          )}
          <p className="mt-2">Site: {location.origin}</p>
          <p>
            Login: <strong data-testid="new-login">{credentials.login}</strong>
          </p>
          <p>
            Password:{" "}
            <strong data-testid="new-password">
              {credentials.password ||
                "Not saved. Make a new one on their page."}
            </strong>
          </p>
          {!manager && (
            <ol className="mt-3 list-decimal pl-5 text-sm">
              <li>Open the site, or scan the code with your phone camera.</li>
              <li>Sign in with this login and password.</li>
              <li>
                Choose your own password, then add the site to your home screen.
              </li>
            </ol>
          )}
        </div>
        <div className="w-28 shrink-0 self-center">
          <QrImage text={location.origin} alt="QR code that opens the site" />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            navigator.clipboard.writeText(text).then(() => toast("Copied."))
          }
        >
          <Copy className="size-4" aria-hidden /> Copy
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Print
        </Button>
        {credentials.existing && credentials.id && (
          <Link
            to={`/admin/users/${credentials.id}`}
            className={buttonClass("secondary")}
          >
            Open their page
          </Link>
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function CreateUser({
  role,
  onClose,
  onCreated,
}: {
  role: "student" | "support" | "manager";
  onClose: () => void;
  onCreated: (credentials: Credentials) => void;
}) {
  const managerViewer = useMe().role === "manager";
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [year, setYear] = useState("");
  const [bio, setBio] = useState("");

  const create = useAction(async () => {
    const { credentials } = await adminUsers<{ credentials: Credentials }>({
      action: "create",
      user: {
        role,
        first_name: first,
        last_name: last,
        birth_year: role === "student" && year ? Number(year) : null,
        bio,
      },
    });
    onCreated(credentials);
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const text = (
    label: string,
    value: string,
    set: (next: string) => void,
    extra = {},
  ) => (
    <Field label={label}>
      {(id, className) => (
        <input
          id={id}
          className={`${className} h-11`}
          value={value}
          onChange={(event) => set(event.target.value)}
          {...extra}
        />
      )}
    </Field>
  );

  return (
    <Modal
      title={
        {
          student: "New student",
          support: "New support teacher",
          manager: "New second-level admin",
        }[role]
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {text("First name", first, setFirst, {
          required: true,
          autoFocus: true,
        })}
        {text("Last name", last, setLast, { required: true })}
        {role === "student" &&
          text("Birth year", year, setYear, {
            type: "number",
            min: 1930,
            max: new Date().getFullYear(),
            required: true,
          })}
        {role === "support" && !managerViewer && (
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
        )}
        <Button type="submit" loading={create.isPending}>
          Create login and password
        </Button>
      </form>
    </Modal>
  );
}

function ImportUsers({
  role,
  onClose,
}: {
  role: "student" | "support";
  onClose: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<ImportedPerson[] | null>(null);
  const [created, setCreated] = useState<Credentials[] | null>(null);
  const [failed, setFailed] = useState(0);

  async function pick(file?: File) {
    if (!file) return;
    try {
      setPeople(await readPeople(file));
    } catch {
      toast("This file could not be read. Use an .xlsx file.", true);
    }
  }

  const run = useAction(async () => {
    const result = await adminUsers<{
      created: Credentials[];
      failed: unknown[];
    }>({
      action: "import",
      users: people!.map((person) => ({ ...person, role })),
    });
    setCreated(result.created);
    setFailed(result.failed.length);
  });

  return (
    <Modal title="Import from Excel" onClose={onClose}>
      {created ? (
        <>
          <p className="mb-3">
            Created {created.filter((item) => !item.existing).length} accounts
            {failed > 0 ? `, ${failed} rows failed` : ""}. Download the
            passwords now: they are not shown again.
          </p>
          {created.some((item) => item.existing) && (
            <p className="mb-3">
              {`Already had an account, not created again: ${created.filter((item) => item.existing).length}. Their current logins are in the file too.`}
            </p>
          )}
          <Button
            block
            onClick={() =>
              downloadExcel(
                "opus-logins.xlsx",
                ["First name", "Last name", "Login", "Password", "Note"],
                created.map((item) => [
                  item.first_name ?? "",
                  item.last_name ?? "",
                  item.login,
                  item.password,
                  item.existing ? "Already had an account" : "",
                ]),
              )
            }
          >
            <Download className="size-4" aria-hidden /> Download logins
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-muted">
            {role === "student"
              ? "Use an .xlsx file with three columns in this order: first name, last name, birth year."
              : "Use an .xlsx file with two columns in this order: first name, last name."}
          </p>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            block
            onClick={() => input.current?.click()}
          >
            <Upload className="size-4" aria-hidden /> Choose file
          </Button>
          {people && (
            <>
              <p className="my-3">{people.length} people found.</p>
              <Button
                block
                disabled={people.length === 0}
                loading={run.isPending}
                onClick={() => run.mutate()}
              >
                Create {people.length} accounts
              </Button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export function UsersPage({ role }: { role: "student" | "support" }) {
  const managerViewer = useMe().role === "manager";
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-users", role, search],
    queryFn: () =>
      rpc<AdminUser[]>("admin_list_users", { p_role: role, p_search: search }),
  });

  const isStudent = role === "student";
  const shown = data?.filter((user) => user.is_active !== archived);

  return (
    <>
      <PageHeader
        title={isStudent ? "Students" : "Support teachers"}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="size-4" aria-hidden />
              <span className="hidden sm:inline">Import</span>
            </Button>
            {data && (
              <Button
                variant="secondary"
                aria-label="Export"
                onClick={() =>
                  downloadExcel(
                    `opus-${role}s.xlsx`,
                    [
                      "First name",
                      "Last name",
                      "Login",
                      "Birth year",
                      "Lessons",
                      "Missed",
                      "Active",
                    ],
                    data.map((user) => [
                      user.first_name,
                      user.last_name,
                      user.login,
                      user.birth_year,
                      user.lessons,
                      user.no_shows,
                      user.is_active ? "Yes" : "No",
                    ]),
                  )
                }
              >
                <Download className="size-4" aria-hidden />
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {isStudent ? "New student" : "New support teacher"}
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex gap-2">
        {[false, true].map((value) => (
          <Button
            key={String(value)}
            size="sm"
            variant={archived === value ? "primary" : "secondary"}
            aria-pressed={archived === value}
            onClick={() => setArchived(value)}
          >
            {value ? (managerViewer ? "Inactive" : "Archive") : "Active"} (
            {data?.filter((user) => user.is_active !== value).length ?? 0})
          </Button>
        ))}
      </div>

      <div className="relative mb-3">
        <Search
          className="absolute left-3 top-3 size-5 text-muted"
          aria-hidden
        />
        <input
          aria-label="Search"
          placeholder="Search by name or login"
          className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-3"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {shown?.length === 0 && (
        <EmptyState
          title={archived ? "The archive is empty" : "Nobody found"}
          hint={
            archived
              ? "People who leave the center are kept here with all their records."
              : undefined
          }
        />
      )}
      {shown && shown.length > 0 && (
        <Table
          head={
            isStudent
              ? ["Name", "Login", "Year", "Lessons", "Missed", "Status"]
              : ["Name", "Login", "Hours", "Lessons", "Rating", "Status"]
          }
        >
          {shown.map((user) => (
            <tr key={user.id}>
              <Cell>
                <Link
                  to={`/admin/users/${user.id}`}
                  className="font-medium hover:underline"
                >
                  {user.first_name} {user.last_name}
                </Link>
              </Cell>
              <Cell className="text-muted">{user.login}</Cell>
              {isStudent ? (
                <Cell>{user.birth_year}</Cell>
              ) : (
                <Cell className="text-sm">
                  {scheduleLines(user.schedule ?? []).join(", ") || "Not set"}
                </Cell>
              )}
              <Cell>{user.lessons}</Cell>
              <Cell>
                {isStudent
                  ? user.no_shows
                  : user.rating && <RatingLine {...user.rating} />}
              </Cell>
              <Cell>
                {!user.is_active && (
                  <Badge>{managerViewer ? "Inactive" : "Archived"}</Badge>
                )}
                {!managerViewer && user.is_active && user.banned_until && (
                  <Badge tone="bad">
                    Banned until {formatDateTime(user.banned_until)}
                  </Badge>
                )}
                {!managerViewer &&
                  user.is_active &&
                  !user.banned_until &&
                  user.strikes > 0 && (
                    <Badge tone="warn">{user.strikes} strikes</Badge>
                  )}
                {user.is_active &&
                  (managerViewer ||
                    (!user.banned_until && user.strikes === 0)) && (
                    <Badge tone="ok">Active</Badge>
                  )}
                {user.is_active && user.push_devices === 0 && (
                  <Badge tone="neutral">No notifications</Badge>
                )}
              </Cell>
            </tr>
          ))}
        </Table>
      )}

      {creating && (
        <CreateUser
          role={role}
          onClose={() => setCreating(false)}
          onCreated={(next) => {
            setCreating(false);
            setCredentials(next);
          }}
        />
      )}
      {importing && (
        <ImportUsers role={role} onClose={() => setImporting(false)} />
      )}
      {credentials && (
        <CredentialsCard
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
    </>
  );
}

export function ManagersPage() {
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-users", "manager", ""],
    queryFn: () =>
      rpc<AdminUser[]>("admin_list_users", { p_role: "manager", p_search: "" }),
  });

  return (
    <>
      <PageHeader
        title="Second-level admins"
        subtitle="They can manage students and support teachers, schedules, reviews and complaints, but cannot change lessons or use developer-only tools."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New second-level admin
          </Button>
        }
      />
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.length === 0 && <EmptyState title="No second-level admins yet" />}
      {data && data.length > 0 && (
        <Table head={["Name", "Login", "Status"]}>
          {data.map((user) => (
            <tr key={user.id}>
              <Cell>
                <Link
                  to={`/admin/users/${user.id}`}
                  className="font-medium hover:underline"
                >
                  {user.first_name} {user.last_name}
                </Link>
              </Cell>
              <Cell className="text-muted">{user.login}</Cell>
              <Cell>
                {user.is_active ? (
                  <Badge tone="ok">Active</Badge>
                ) : (
                  <Badge>Inactive</Badge>
                )}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
      {creating && (
        <CreateUser
          role="manager"
          onClose={() => setCreating(false)}
          onCreated={(next) => {
            setCreating(false);
            setCredentials({ ...next, role: "manager" });
            refetch();
          }}
        />
      )}
      {credentials && (
        <CredentialsCard
          credentials={credentials}
          manager
          onClose={() => setCredentials(null)}
        />
      )}
    </>
  );
}
