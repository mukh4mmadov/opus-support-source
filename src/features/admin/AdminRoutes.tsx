import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "../../app/auth";
import { ChatList } from "../chat/Chat";
import { Audit } from "./Audit";
import { Bookings } from "./Bookings";
import { Complaints } from "./Complaints";
import { Dashboard } from "./Dashboard";
import { Errors } from "./Errors";
import { Messages } from "./Messages";
import { Days } from "./Days";
import { Penalties } from "./Penalties";
import { Reviews } from "./Reviews";
import { SettingsPage } from "./SettingsPage";
import { StaffAttendance } from "./StaffAttendance";
import { Stats } from "./Stats";
import { Texts } from "./Texts";
import { UserDetail } from "./UserDetail";
import { ManagersPage, UsersPage } from "./Users";
import { AttendanceQr } from "../attendance/AttendanceQr";

export default function AdminRoutes() {
  const me = useMe();
  if (me.role === "manager") {
    return (
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="students" element={<UsersPage role="student" />} />
        <Route path="supports" element={<UsersPage role="support" />} />
        <Route path="users/:id" element={<UserDetail />} />
        <Route path="days" element={<Days />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="stats" element={<Stats />} />
        <Route path="attendance" element={<StaffAttendance />} />
        <Route path="attendance/qr" element={<AttendanceQr />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="bookings" element={<Bookings />} />
      <Route path="students" element={<UsersPage role="student" />} />
      <Route path="supports" element={<UsersPage role="support" />} />
      <Route path="managers" element={<ManagersPage />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="days" element={<Days />} />
      <Route path="penalties" element={<Penalties />} />
      <Route path="reviews" element={<Reviews />} />
      <Route path="complaints" element={<Complaints />} />
      <Route path="chats" element={<ChatList title="All chats" />} />
      <Route path="messages" element={<Messages />} />
      <Route path="stats" element={<Stats />} />
      <Route path="attendance" element={<StaffAttendance />} />
      <Route path="attendance/qr" element={<AttendanceQr />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="texts" element={<Texts />} />
      <Route path="audit" element={<Audit />} />
      <Route path="errors" element={<Errors />} />
    </Routes>
  );
}
