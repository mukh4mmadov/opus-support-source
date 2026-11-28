import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui";
import { isImpersonating, useAuth, useMe } from "./auth";
import { FirstPassword } from "./FirstPassword";
import { useText } from "./config";
import { belongsToAnotherRole } from "./routeAccess";
import { AdminShell, AppShell } from "./Shell";
import { Login } from "../features/auth/Login";
import { StudentHome } from "../features/student/StudentHome";
import { SupportsList } from "../features/student/SupportsList";
import { SupportPage } from "../features/student/SupportPage";
import { Book } from "../features/student/Book";
import { CheckInPage } from "../features/checkin/StudentCheckIn";
import { History } from "../features/history/History";
import { Leaderboard } from "../features/leaderboard/Leaderboard";
import { Guide } from "../features/rules/Guide";
import { SupportToday } from "../features/support/SupportToday";
import { SupportCalendar } from "../features/support/SupportCalendar";
import { SupportAttendance } from "../features/attendance/SupportAttendance";
import { ChatList, ChatThread } from "../features/chat/Chat";
import { Alerts } from "../features/notifications/Alerts";
import { Profile } from "../features/profile/Profile";

const AdminRoutes = lazy(() => import("../features/admin/AdminRoutes"));
const HistoryStats = lazy(() => import("../features/history/HistoryStats"));

const Waiting = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<Spinner />}>{children}</Suspense>
);

function NotFound() {
  const me = useMe();
  const t = useText();
  const { pathname } = useLocation();
  if (belongsToAnotherRole(me.role, pathname))
    return <Navigate to="/" replace />;
  return <p className="p-10 text-center text-muted">{t("common.not_found")}</p>;
}

function SignedIn() {
  const me = useMe();
  if (me.must_change_password && !isImpersonating()) return <FirstPassword />;

  const shared = (
    <>
      <Route path="alerts" element={<Alerts />} />
      <Route path="profile" element={<Profile />} />
      <Route path="guide" element={<Guide />} />
      <Route path="rules" element={<Navigate to="/guide" replace />} />
      <Route path="top" element={<Leaderboard />} />
      <Route path="chat" element={<ChatList />} />
      <Route path="chat/:id" element={<ChatThread />} />
    </>
  );

  if (me.role === "manager") {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AdminShell />}>
            <Route index element={<Navigate to="/admin" replace />} />
            <Route path="admin/*" element={<AdminRoutes />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="profile" element={<Profile />} />
            <Route path="guide" element={<Guide />} />
            <Route path="rules" element={<Navigate to="/guide" replace />} />
            <Route path="top" element={<Leaderboard />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    );
  }

  if (me.role === "admin") {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AdminShell />}>
            <Route index element={<Navigate to="/admin" replace />} />
            <Route path="admin/*" element={<AdminRoutes />} />
            {shared}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        {me.role === "student" ? (
          <>
            <Route index element={<StudentHome />} />
            <Route path="book" element={<Book />} />
            <Route path="supports" element={<SupportsList />} />
            <Route path="supports/:id" element={<SupportPage />} />
            <Route path="history" element={<History />} />
            <Route
              path="history/stats"
              element={
                <Waiting>
                  <HistoryStats />
                </Waiting>
              }
            />
            <Route path="checkin" element={<CheckInPage />} />
          </>
        ) : (
          <>
            <Route index element={<SupportToday />} />
            <Route path="calendar" element={<SupportCalendar />} />
            <Route path="attendance" element={<SupportAttendance />} />
            <Route path="attend" element={<SupportAttendance />} />
            <Route path="history" element={<History />} />
            <Route
              path="history/stats"
              element={
                <Waiting>
                  <HistoryStats />
                </Waiting>
              }
            />
          </>
        )}
        {shared}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  return me ? <SignedIn /> : <Login />;
}
