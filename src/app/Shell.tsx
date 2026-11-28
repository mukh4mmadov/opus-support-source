import { useEffect, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Ban,
  Bell,
  BookMarked,
  BookOpen,
  Bug,
  CalendarCheck,
  CircleAlert,
  CalendarPlus,
  CalendarDays,
  CalendarOff,
  Clock,
  ChartColumn,
  GraduationCap,
  History,
  House,
  ShieldCheck,
  Languages,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageCircle,
  MessagesSquare,
  ScrollText,
  Settings,
  Star,
  Trophy,
  User,
  Users,
  X,
} from "lucide-react";
import { rpc, supabase } from "../lib/api";
import { PushReminder } from "../features/notifications/PushCard";
import { isImpersonating, returnToAdmin, useAuth, useMe } from "./auth";
import { tap } from "../lib/celebrate";
import { useConfig, useText } from "./config";

export function Brand({ large }: { large?: boolean }) {
  const { settings } = useConfig();
  return (
    <img
      src={settings.logo_data_url || "/logo.png"}
      alt={settings.center_name}
      className={large ? "mx-auto h-24" : "h-10"}
    />
  );
}

function useLiveUpdates(userId: string, includeMessages = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`user-${userId}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      () => queryClient.invalidateQueries(),
    );
    if (includeMessages) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => queryClient.invalidateQueries({ queryKey: ["chat"] }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient, includeMessages]);
}

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface print:hidden">
      <div className="mx-auto flex max-w-2xl">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={tap}
            className={({ isActive }) =>
              clsx(
                "group relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition active:scale-90",
                isActive
                  ? "font-semibold text-brand-ink before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-accent"
                  : "text-muted",
              )
            }
          >
            <item.icon
              className="size-5 transition-transform duration-300 group-aria-[current=page]:-translate-y-0.5 group-aria-[current=page]:scale-110"
              aria-hidden
            />
            {item.label}
            {Boolean(item.badge) && (
              <span className="absolute left-1/2 top-1 ml-1.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function OfflineBar() {
  const t = useText();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 bg-bad px-4 py-1.5 text-center text-sm font-medium text-white dark:text-black"
    >
      {t("offline.bar")}
    </div>
  );
}

function ImpersonationBar({ name }: { name: string }) {
  if (!isImpersonating()) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-2 bg-warn px-4 py-1.5 text-sm font-medium text-white dark:text-black">
      <span className="min-w-0 truncate">Admin view: signed in as {name}</span>
      <button
        type="button"
        onClick={returnToAdmin}
        className="shrink-0 rounded-md bg-black/20 px-2 py-1"
      >
        Back to admin
      </button>
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const t = useText();
  const { pathname } = useLocation();
  useLiveUpdates(me.id);

  const items: NavItem[] =
    me.role === "student"
      ? [
          { to: "/", label: t("nav.home"), icon: House },
          { to: "/book", label: t("nav.book"), icon: CalendarPlus },
          { to: "/history", label: t("nav.history"), icon: History },
          ...(me.chat_enabled
            ? [{ to: "/chat", label: t("nav.chat"), icon: MessageCircle }]
            : []),
          {
            to: "/alerts",
            label: t("nav.alerts"),
            icon: Bell,
            badge: me.unread,
          },
        ]
      : [
          { to: "/", label: t("nav.today"), icon: CalendarCheck },
          { to: "/calendar", label: t("nav.calendar"), icon: CalendarDays },
          { to: "/history", label: t("nav.history"), icon: History },
          ...(me.chat_enabled
            ? [{ to: "/chat", label: t("nav.chat"), icon: MessageCircle }]
            : []),
          {
            to: "/alerts",
            label: t("nav.alerts"),
            icon: Bell,
            badge: me.unread,
          },
        ];

  return (
    <div className="min-h-dvh pb-20">
      <OfflineBar />
      <ImpersonationBar name={`${me.first_name} ${me.last_name}`} />
      <header className="sticky top-0 z-30 bg-brand text-brand-fg print:hidden">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
          <Link to="/" className="shrink-0">
            <Brand />
          </Link>
          <Link
            to="/profile"
            aria-label={t("nav.profile")}
            className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-3 pr-1 hover:bg-white/10"
          >
            <span
              className="truncate text-sm font-medium"
              data-testid="role-badge"
            >
              {t(`role.${me.role}`)}
            </span>
            <span className="rounded-full bg-white/15 p-1.5">
              <User className="size-4" aria-hidden />
            </span>
          </Link>
        </div>
      </header>
      <main key={pathname} className="animate-rise mx-auto max-w-2xl px-4 py-5">
        <Outlet />
      </main>
      <PushReminder />
      <BottomNav items={items} />
    </div>
  );
}

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/bookings", label: "Bookings", icon: BookOpen },
  { to: "/admin/students", label: "Students", icon: Users },
  { to: "/admin/supports", label: "Support teachers", icon: GraduationCap },
  { to: "/admin/managers", label: "Second-level admins", icon: ShieldCheck },
  { to: "/admin/days", label: "Closed days", icon: CalendarOff },
  { to: "/admin/attendance", label: "Staff attendance", icon: Clock },
  { to: "/admin/penalties", label: "Bans & warnings", icon: Ban },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/complaints", label: "Complaints", icon: CircleAlert },
  { to: "/admin/chats", label: "Chats", icon: MessagesSquare },
  { to: "/admin/messages", label: "Send a message", icon: Megaphone },
  { to: "/admin/stats", label: "Statistics", icon: ChartColumn },
  { to: "/top", label: "Top students", icon: Trophy },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/guide", label: "Guide and rules", icon: BookMarked },
  { to: "/admin/texts", label: "Texts", icon: Languages },
  { to: "/admin/audit", label: "Activity log", icon: ScrollText },
  { to: "/admin/errors", label: "Errors", icon: Bug },
];

const MANAGER_NAV = [
  "/admin",
  "/admin/bookings",
  "/admin/students",
  "/admin/supports",
  "/admin/days",
  "/admin/attendance",
  "/admin/reviews",
  "/admin/complaints",
  "/admin/stats",
  "/top",
  "/guide",
];

export function AdminShell() {
  const me = useMe();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useLiveUpdates(me.id, me.role === "admin");
  const { data: openErrors = 0 } = useQuery({
    queryKey: ["admin-error-count"],
    queryFn: () => rpc<number>("admin_error_count"),
    enabled: me.role === "admin",
    refetchInterval: 60_000,
  });

  useEffect(() => setOpen(false), [pathname]);

  const links = (
    <nav className="flex flex-col gap-0.5 p-3">
      {ADMIN_NAV.filter(
        (item) =>
          me.role === "admin" ||
          (me.role === "manager" && MANAGER_NAV.includes(item.to)),
      ).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/admin"}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2",
              isActive
                ? "bg-brand-soft font-semibold text-brand-ink"
                : "text-ink hover:bg-sunken",
            )
          }
        >
          <item.icon className="size-5" aria-hidden />
          {item.label}
          {item.to === "/admin/errors" && openErrors > 0 && (
            <span className="ml-auto rounded-full bg-bad px-1.5 text-xs font-semibold text-white">
              {openErrors}
            </span>
          )}
        </NavLink>
      ))}
      <NavLink
        to="/alerts"
        className={({ isActive }) =>
          clsx(
            "flex items-center gap-3 rounded-lg px-3 py-2",
            isActive
              ? "bg-brand-soft font-semibold text-brand-ink"
              : "text-ink hover:bg-sunken",
          )
        }
      >
        <Bell className="size-5" aria-hidden />
        Notifications
        {me.unread > 0 && (
          <span className="ml-auto rounded-full bg-bad px-1.5 text-xs font-semibold text-white">
            {me.unread}
          </span>
        )}
      </NavLink>
      <NavLink
        to="/profile"
        className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-sunken"
      >
        <User className="size-5" aria-hidden />
        Profile
      </NavLink>
      <button
        type="button"
        onClick={signOut}
        className="rounded-lg px-3 py-2 text-left text-muted hover:bg-sunken"
      >
        Sign out
      </button>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <div className="fixed inset-x-0 top-0 z-50">
        <OfflineBar />
      </div>
      <aside className="sticky top-0 hidden h-dvh w-60 print:!hidden shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
        <div className="flex h-14 items-center bg-brand px-3">
          <Brand />
        </div>
        {links}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-brand px-3 text-brand-fg lg:hidden print:hidden">
        <Brand />
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 hover:bg-white/10"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 w-64 overflow-y-auto bg-surface">
            <div className="flex h-14 items-center justify-end px-3">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 hover:bg-sunken"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {links}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-5 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
