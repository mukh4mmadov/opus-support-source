export type Role = "student" | "support" | "admin" | "manager";

export type BookingStatus =
  | "booked"
  | "needs_transfer"
  | "attended"
  | "no_show"
  | "cancelled"
  | "support_absent"
  | "unmarked"
  | "excused";

export interface Me {
  id: string;
  role: Role;
  login: string;
  first_name: string;
  last_name: string;
  chat_enabled: boolean;
  reviews_enabled: boolean;
  leaderboard_enabled: boolean;
  instant_enabled: boolean;
  staff_attendance: boolean;
  unread: number;
  must_change_password: boolean;
  rules: Rules;
}

export interface Rules {
  min_days: number;
  max_days: number;
  cancel_days: number;
  wait_days: number;
  close_days: number;
  no_show_minutes: number;
  mark_minutes: number;
  alert_minutes: number;
  auto_no_show: boolean;
  qr_required: boolean;
  excused_limit: number;
  warnings: number;
  ban_days: number;
  reset_days: number;
  instant_minutes: number;
  instant_per_day: number;
  daily_minutes: number;
  moves_per_month: number;
  review_days: number;
  complaint_days: number;
}

export interface AttendanceCounts {
  attended: number;
  no_show: number;
  excused: number;
  cancelled: number;
  support_absent: number;
  unmarked: number;
  forgot: number;
  closed_same_day: number;
}

export interface AttendanceSummary {
  week: AttendanceCounts;
  month: AttendanceCounts;
  year: AttendanceCounts;
  all: AttendanceCounts;
}

export interface Booking {
  id: string;
  student_id: string;
  support_id: string;
  student_name: string;
  support_name: string;
  lesson_date: string;
  starts_at: string;
  ends_at: string;
  topic: string;
  status: BookingStatus;
  cancel_reason: string | null;
  marked_at: string | null;
  can_cancel: boolean;
  no_show_from: string;
  mark_until: string;
  auto_marked: boolean;
  excuse_reason: string;
  checked_in_at: string | null;
  must_change_password: boolean;
  instant: boolean;
  review?: { rating: number; comment: string } | null;
  can_review?: boolean;
  review_until?: string | null;
  can_complain?: boolean;
  complaint_until?: string | null;
  complaint?: {
    body: string;
    reply: string;
    created_at: string;
    seen_at: string | null;
    answered_at: string | null;
  } | null;
}

export interface Rating {
  average: number;
  count: number;
}

export interface ScheduleRow {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

export interface StudentHome {
  active: Booking | null;
  checkin_lesson: Booking | null;
  same_day_pass: boolean;
  support_phone: string | null;
  transfer_options: { support_id: string; name: string }[];
  ban: { ends_at: string; reason: string } | null;
  rebook_from: string | null;
  strikes: number;
  warnings_before_ban: number;
  pending_review: Booking | null;
  announcements: Announcement[];
  rules: {
    min_days: number;
    max_days: number;
    lesson_minutes: number;
    topic_required: boolean;
    topic_max_length: number;
    cancel_days_before: number;
    moves_per_month: number;
  };
  moves_left: number;
  today: string;
}

export interface SupportCard {
  id: string;
  name: string;
  bio: string;
  rating: Rating;
  schedule: ScheduleRow[];
  next_free: string | null;
}

export interface SupportDetail extends Omit<SupportCard, "next_free"> {
  days: { date: string; closed: boolean; free: number; slots: number }[];
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  is_free: boolean;
}

export interface DayOption {
  date: string;
  free: number;
}

export interface DaySlot extends Slot {
  can_wait: boolean;
  waiting: boolean;
}

export interface DaySupport {
  id: string;
  name: string;
  bio: string;
  rating: Rating;
  slots: DaySlot[];
}

export interface BookingOptions {
  waitlist_enabled: boolean;
  favorites: string[];
}

export interface Closure {
  id: string;
  closed_on: string;
  reason: string;
  center_wide?: boolean;
  start_time: string | null;
  end_time: string | null;
  can_reopen?: boolean;
}

export interface SupportHome {
  today: string;
  now: string;
  lessons_today: Booking[];
  upcoming: Booking[];
  closures: Closure[];
  close_from: string;
  lessons_this_month: number;
  schedule: ScheduleRow[];
  rating: Rating;
  announcements: Announcement[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export interface ChatThread extends Booking {
  last_message: string | null;
  unread: number;
}

export interface ChatView {
  booking: Booking;
  can_send: boolean;
  messages: {
    id: string;
    sender_id: string | null;
    sender: string | null;
    body: string;
    created_at: string;
    read_at: string | null;
    from_admin: boolean;
    deleted_at: string | null;
  }[];
}

export interface AdminUser {
  id: string;
  role: Role;
  login: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  bio: string;
  is_active: boolean;
  created_at: string;
  archived_at: string | null;
  password_changed_at: string | null;
  strikes: number;
  banned_until: string | null;
  push_devices: number;
  lessons: number;
  no_shows: number;
  rating: Rating | null;
  schedule: ScheduleRow[] | null;
}

export interface Credentials {
  id?: string;
  login: string;
  password: string;
  first_name?: string;
  last_name?: string;
  existing?: boolean;
  archived?: boolean;
  role?: Role;
}

export type StaffDayStatus = "off" | "waiting" | "missing" | "here" | "done" | "absent" | "excused";

export interface StaffDay {
  id: string | null;
  support_id: string;
  support_name: string;
  work_date: string;
  expected_start: string | null;
  expected_end: string | null;
  arrived_at: string | null;
  left_at: string | null;
  left_estimated: string | null;
  status: StaffDayStatus;
  late_minutes: number;
  is_late: boolean;
  early_minutes: number;
  is_early: boolean;
  no_leave: boolean;
  worked_minutes: number | null;
  arrive_manual_by: string | null;
  leave_manual_by: string | null;
  manual_note: string;
  excused: boolean;
  excuse_note: string;
  excused_by: string | null;
  face_checks: number;
  face_failed: number;
}

export interface MyStaffAttendance {
  enabled: boolean;
  face_set: boolean;
  today: StaffDay;
  days: StaffDay[];
}
