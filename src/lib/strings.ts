import { GUIDE_EN } from "./guideStrings";

export const DEFAULT_STRINGS = {
  "login.title": "Sign in",
  "login.subtitle": "Use the login and password from the reception.",
  "login.login": "Login",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.failed": "Wrong login or password.",
  "login.too_many": "Too many attempts. Wait a few minutes and try again.",

  "nav.home": "Home",
  "nav.supports": "Supports",
  "nav.book": "Book",
  "nav.history": "History",
  "nav.chat": "Chat",
  "nav.alerts": "Alerts",
  "nav.profile": "Profile",
  "nav.today": "Today",
  "nav.calendar": "Calendar",

  "home.greeting": "Hello, {name}",
  "home.next_lesson": "Your next lesson",
  "home.no_lesson": "No lesson booked",
  "home.no_lesson_hint": "Pick a support teacher and a time that suits you.",
  "home.book": "Book a lesson",
  "home.topic": "Topic",
  "home.cancel": "Cancel booking",
  "home.cancel_confirm":
    "Cancel your lesson with {support} on {lesson}? Because you gave up a lesson, you can book again from {date}, 00:00.",
  "home.cancel_closed":
    "This lesson can no longer be cancelled. If you cannot come, tell your support teacher before the lesson. They can mark it as excused, and then there is no penalty.",
  "home.open_chat": "Message support",
  "home.support_phone": "Phone: {phone}",
  "home.rebook_title": "Booking opens again on {date}, 00:00",
  "home.rebook":
    "You gave up a lesson, so you can book again from {date}, 00:00.",
  "home.rules_link": "Guide and rules",
  "home.same_day_title": "You can book for today",
  "home.same_day":
    "Your lesson was cancelled because of a closed day. This was not your fault, so today is open for you. Pick another free time.",
  "home.banned": "You cannot book until {until}.",
  "home.banned_title": "Booking is blocked",
  "home.warned_title": "You have a warning",
  "home.warned":
    "You missed a lesson. If you miss another one, booking will be blocked.",
  "home.rate_title": "How was your lesson with {name}?",
  "home.rate_comment": "Add a comment (optional)",
  "home.rate_send": "Send review",
  "home.rate_thanks": "Thank you for your review.",
  "home.rate_until": "You can rate this lesson until {when}.",
  "home.rate_private":
    "Only the center reads your comment. Your stars count toward the average, and nobody else sees who gave how many.",
  "home.transfer_title": "Your support teacher is not available",
  "home.transfer_body":
    "{name} cannot teach on {date} at {time}. Choose another support teacher for the same time.",
  "home.transfer_decline": "Cancel the lesson instead",
  "home.moved": "Your lesson was moved.",

  "supports.title": "Support teachers",
  "supports.subtitle": "Read about them and see their ratings.",
  "supports.next_free": "Next free: {when}",
  "supports.no_free": "No free time this week",
  "supports.none": "No support teachers have been added yet.",
  "supports.reviews": "{count} ratings",
  "supports.no_reviews": "No ratings yet",
  "supports.about": "About",
  "supports.works": "Working hours",
  "supports.rating_private":
    "The rating is the average of students' stars. Comments are read only by the center.",

  "book.title": "Book a lesson",
  "book.subtitle": "Pick a day, then a free time.",
  "book.no_slots": "Nobody works on this day.",
  "book.no_days": "There is no free time this week.",
  "book.all_supports": "See all support teachers",
  "book.favorite": "Favorite support teacher",

  "wait.taken": "taken, join the waiting list",
  "wait.explain":
    "This time is taken. Join the waiting list and we will tell you if it frees up. Whoever books first gets it.",
  "wait.on_list": "You are on the waiting list for this time.",
  "wait.join": "Join the waiting list",
  "wait.leave": "Leave the waiting list",
  "wait.joined": "You are on the waiting list.",
  "wait.left": "You left the waiting list.",

  "calendar.add": "Add to calendar",
  "calendar.phone": "Phone calendar",
  "calendar.google": "Google Calendar",
  "calendar.title": "OPUS lesson with {name}",

  "offline.bar": "No internet. Nothing can be saved until you are back online.",
  "book.closed": "Closed",
  "book.free": "{count} free",
  "book.topic_label": "What do you want to study?",
  "book.topic_hint": "Your support teacher will prepare for this topic.",
  "book.topic_placeholder":
    "For example: Present Perfect, IELTS Writing Task 2",
  "book.confirm": "Confirm booking",
  "book.done": "Lesson booked.",
  "book.blocked_active":
    "You already have an active booking. The next one opens after that lesson.",
  "book.blocked_ban": "Booking is blocked until {until}.",
  "book.blocked_rebook":
    "You gave up a lesson, so you can book again from {date}, 00:00.",

  "history.title": "My lessons",
  "history.empty": "Your lessons will appear here.",
  "history.rate": "Rate lesson",
  "history.auto":
    "Marked automatically: this lesson was not confirmed in time.",
  "history.reason": "Reason: {reason}",
  "history.week": "This week",
  "history.month": "This month",
  "history.year": "This year",
  "history.all": "All time",
  "history.period": "Period",
  "history.came": "Came",
  "history.missed": "Missed",
  "history.excused": "Excused",
  "history.cancelled": "Cancelled",
  "history.forgot": "You forgot to mark",
  "history.closed_same_day": "Closed on the day",
  "history.stats": "Statistics",
  "history.chart_title": "Lessons over time",
  "history.by_week": "Weeks",
  "history.by_month": "Months",

  "checkin.title": "Lesson time: confirm you came",
  "checkin.hint":
    "Ask your support teacher to press Came, then scan the code they show. Do this before {time}, or the lesson counts as missed.",
  "checkin.scan": "Scan the QR code",
  "checkin.code": "Or type the 6-digit code",
  "checkin.submit": "Confirm",
  "checkin.done": "You are checked in. Have a good lesson!",
  "checkin.wrong":
    "This code did not work. Ask your support teacher for the code on their screen now.",
  "checkin.no_camera": "The camera did not open. Type the code instead.",
  "checkin.show_title": "Show this to {name}",
  "checkin.show_code":
    "If the camera does not work, the student types this code",
  "checkin.show_hint":
    "The lesson counts only after the student scans this code. It changes every few seconds, so a photo of it soon stops working.",

  "complaint.open": "Report a problem",
  "complaint.title": "Report a problem with this lesson",
  "complaint.hint":
    "Only the center reads this. Your support teacher does not see it.",
  "complaint.label": "What happened?",
  "complaint.until": "You can send it until {when}.",
  "complaint.send": "Send to the center",
  "complaint.sent": "Sent. The center will answer you here.",
  "complaint.yours": "Your message",
  "complaint.answer": "Answer",
  "complaint.waiting": "The center has not answered yet.",

  "top.title": "Top students",
  "top.subtitle": "Who attended the most lessons in the whole center.",
  "top.empty": "No lessons yet. The first one takes first place.",
  "top.lessons": "Lessons: {count}",
  "top.my_place": "You are number {place} this month. Lessons: {lessons}.",
  "top.invite": "See who attended the most lessons this month.",
  "nav.top": "Top students",

  "chat.title": "Messages",
  "chat.empty": "A chat opens when you have an active booking.",
  "chat.placeholder": "Write a message",
  "chat.closed": "This chat is closed because the lesson has ended.",
  "chat.start": "No messages yet. Say hello.",
  "chat.notice": "The center can read these messages.",

  "alerts.title": "Notifications",
  "alerts.empty": "Nothing here yet.",
  "alerts.read_all": "Mark all read",
  "alerts.enable_push": "Turn on phone notifications",
  "alerts.push_on": "Phone notifications are on",
  "alerts.push_hint_ios": "On iPhone, add this site to your Home Screen first.",
  "alerts.push_denied": "Notifications are blocked in your browser settings.",

  "profile.title": "Profile",
  "profile.password": "Change password",
  "profile.new_password": "New password",
  "profile.repeat_password": "Repeat new password",
  "profile.save_password": "Save password",
  "profile.password_saved": "Password changed.",
  "profile.password_short": "Use at least 8 characters.",
  "profile.password_mismatch": "The passwords do not match.",
  "profile.theme": "Appearance",
  "profile.logout": "Sign out",
  "profile.help": "Need help?",
  "profile.rules": "Guide and rules",

  "today.title": "Today",
  "today.no_lessons": "No lessons today.",
  "today.upcoming": "Upcoming lessons",
  "today.no_upcoming": "No upcoming lessons.",
  "today.attended": "Came",
  "today.no_show": "Did not come",
  "today.no_show_at": "From {time}",
  "today.excused": "Excused",
  "today.excuse_title": "Excuse {name}",
  "today.excuse_hint":
    "Only if the student really told you they cannot come. There is no penalty. The center sees every excused lesson and its reason.",
  "today.excuse_reason": "Why can they not come?",
  "today.excuse_save": "Mark as excused",
  "today.change": "Change mark",
  "today.mark_until":
    "Confirm before {time}. After that the lesson counts as missed and the student gets a penalty.",
  "today.marked": "Saved.",
  "today.no_topic": "No topic given",
  "today.not_started": "Starts at {time}",

  "close.title": "Time off",
  "close.subtitle":
    "If you cannot come, close the day or the hours here as early as you can, and at the latest before the lesson starts. Booked students are told and offered another support teacher. Closing on the day itself is reported to the center.",
  "close.date": "Date",
  "close.whole_day": "Whole day",
  "close.from": "From",
  "close.to": "To",
  "close.reason": "Reason (optional)",
  "close.submit": "Close this time",
  "close.confirm":
    "Close {when}? Students booked for that time will be notified.",
  "close.done": "Day closed.",
  "close.done_moved": "Day closed. {count} students were notified.",
  "close.reopen": "Reopen",
  "close.by_center": "Closed by the center",
  "close.none": "No closed days.",

  "status.booked": "Booked",
  "status.needs_transfer": "Needs a new teacher",
  "status.attended": "Attended",
  "status.no_show": "Missed",
  "status.cancelled": "Cancelled",
  "status.support_absent": "Support absent",
  "status.unmarked": "Not marked",
  "status.excused": "Excused",

  "common.loading": "Loading",
  "common.error": "Something went wrong. Try again.",
  "common.retry": "Try again",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.confirm": "Yes, continue",
  "common.not_found": "This page does not exist.",

  "error.STUDENT_BANNED": "You are banned from booking right now.",
  "error.DATE_OUT_OF_RANGE": "This date cannot be booked.",
  "error.ACTIVE_BOOKING_EXISTS": "You already have an active booking.",
  "error.DAILY_LIMIT_REACHED": "You already have a lesson on this day.",
  "error.SLOT_UNAVAILABLE": "Someone just took this time. Pick another one.",
  "error.TOPIC_REQUIRED": "Write what you want to study.",
  "error.TOPIC_TOO_LONG": "The topic is too long.",
  "error.CANCEL_TOO_LATE": "It is too late to cancel this lesson.",
  "error.BOOKING_NOT_ACTIVE":
    "This booking has already changed. Refresh the page.",
  "error.LESSON_NOT_STARTED": "The lesson has not started yet.",
  "error.NO_SHOW_TOO_EARLY": "It is too early to mark this student as absent.",
  "error.ALREADY_MARKED": "This lesson is already marked.",
  "error.MARKING_CLOSED":
    "Marking is closed for this lesson. Only the center can change it now.",
  "error.EXCUSE_NOT_TODAY": "A lesson can be excused only on its own day.",
  "error.EXCUSE_REASON_REQUIRED": "Write why the student cannot come.",
  "error.EXCUSE_LIMIT_REACHED":
    "This student has used all excused lessons for now. Only the center can excuse this one.",
  "error.REBOOK_LATER":
    "You gave up a lesson, so you cannot book yet. Your home page shows when booking opens again.",
  "error.CHAT_CLOSED": "This chat is closed.",
  "error.FORBIDDEN": "You do not have access to this.",
  "error.USER_NOT_FOUND": "This account no longer exists.",
  "error.NETWORK":
    "No connection, so this was not confirmed. Check your internet and try again.",
  "error.WAITLIST_FULL":
    "Your waiting list is full. Leave one before joining another.",
  "error.WAITLIST_NOT_NEEDED": "This time is free now. Refresh and book it.",
  "error.DATE_IN_PAST": "This date has passed.",
  "error.CLOSE_TOO_LATE": "It is too late to close this date. Call the center.",
  "error.LESSON_ALREADY_STARTED":
    "A lesson has already started at this time. Finish it first.",
  "error.QR_REQUIRED": "The student has to scan the code for this.",
  "error.CHECKIN_LOCKED":
    "Too many wrong codes. Tell the center about this lesson.",
  "error.COMPLAINT_EMPTY": "Write what happened.",
  "error.COMPLAINT_EXISTS": "You have already reported this lesson.",
  "error.CLOSED_BY_CENTER": "The center closed this time. Only the center can reopen it.",
  "error.COMPLAINT_NOT_YET":
    "You can report a problem once the lesson has taken place or been cancelled.",
  "error.COMPLAINT_CLOSED":
    "Reporting a problem with this lesson has closed. Please go to reception.",
  "error.REVIEWS_DISABLED": "Rating lessons is turned off.",
  "error.REVIEW_NOT_ALLOWED": "You can rate only a lesson you attended.",
  "error.REVIEW_TOO_EARLY": "You can rate the lesson once it has ended.",
  "error.REVIEW_CLOSED": "Rating this lesson has closed.",
  "error.REVIEW_EXISTS": "You have already rated this lesson.",
  "error.RATING_INVALID": "Choose from 1 to 5 stars.",
  "error.LEADERBOARD_DISABLED": "The ranking is turned off.",
  "error.HOURS_INVALID": "The end time must be after the start time.",
  "error.PASSWORD_INVALID": "Use at least 8 characters.",
  "error.PASSWORD_NOT_STORED":
    "This password is not available. Create a new one.",
  "error.ATTENDANCE_OFF": "Attendance is turned off.",
  "error.ATTENDANCE_NOT_SET_UP": "Attendance is not set up yet. Tell the developer.",
  "error.FACE_NOT_SET":
    "The developer has not uploaded your photo yet. Ask reception to mark you by hand.",
  "error.QR_INVALID": "This is not the attendance QR. Scan the QR on the reception screen.",
  "error.QR_USED": "This QR was just used. Scan the new one on the screen.",
  "error.QR_EXPIRED": "This QR has changed. Scan the new one on the screen.",
  "error.GPS_NEEDED": "Allow location for OPUS and turn on GPS, then scan again.",
  "error.TOO_FAR": "Your phone is not at the center. Scanning works only at the center.",
  "error.ATTENDANCE_DONE": "You have already scanned in and out today.",
  "error.SCAN_EXPIRED": "Too much time passed. Scan the QR again.",
  "error.SCAN_CLOSED": "This scan is finished. Scan the QR again.",
  "error.FACE_INVALID": "The face check could not be read. Try again.",
  "error.FACE_REPLAY": "This face check was already used. Do it again.",
  "error.ATTENDANCE_BY_SCAN": "Scan the attendance QR at reception instead.",
  "error.NOTE_REQUIRED": "Write a note.",
  "error.TIME_INVALID": "Check the times.",
  "error.ATTENDANCE_ALREADY_SET": "This time is already recorded. Only the developer can change it.",
  "error.RANGE_INVALID": "Choose a shorter period.",

  "role.student": "Student",
  "role.support": "Support teacher",
  "role.admin": "Admin",
  "role.manager": "Second-level admin",

  "today.month_lessons": "Lessons this month: {count}",

  "install.title": "Add OPUS to your phone",
  "install.button": "Install",
  "install.ios":
    "In Safari, tap the Share button, then choose Add to Home Screen.",

  "push.title": "Turn on notifications",
  "push.why_student":
    "This is important. Without notifications you can get a penalty and not know why.",
  "push.student_1":
    "If your lesson is not confirmed in time, it counts as missed and you get a penalty. A notification gives you time to put it right.",
  "push.student_2":
    "You are told at once if your support teacher cannot come, or if your lesson changes.",
  "push.student_3":
    "You get a reminder before each lesson, so you do not miss it by accident.",
  "push.why_support":
    "This is important. Without notifications a student can get a penalty because of you.",
  "push.support_1":
    "You are warned while there is still time to confirm a lesson. If it is not confirmed, the student gets a penalty and it is recorded on your account.",
  "push.support_2": "You see new bookings and cancellations at once.",
  "push.support_3":
    "You get students' messages, such as when they cannot come.",
  "push.why_admin":
    "This is important. Without notifications you find out about problems late.",
  "push.admin_1":
    "You are told each time a lesson is excused, so false marks do not pass unnoticed.",
  "push.admin_2": "You are told when a lesson is left unmarked.",
  "push.admin_3": "You see password changes and other account events at once.",
  "push.why_manager": "This is important. Without notifications you find out about problems late.",
  "push.manager_1": "You are told about each new complaint, so the student gets an answer soon.",
  "push.manager_2": "You are told when a support teacher closes a day on the day itself.",
  "push.manager_3": "You are told when a lesson is left unmarked.",
  "push.turn_on": "Turn on notifications",
  "push.later": "Later",
  "push.on": "Notifications are on.",
  "push.failed": "Notifications could not be turned on. Try again.",
  "push.install_steps":
    "On iPhone, notifications work only after you add this site to your Home Screen. In Safari tap the Share button, choose Add to Home Screen, then open OPUS from there and come back to this page.",
  "push.blocked_steps":
    "Notifications are blocked for this site. Tap the lock icon next to the address, open Permissions or Site settings, set Notifications to Allow, then reload the page.",

  "rules.title": "Rules",
  "rules.subtitle": "Please read these carefully. They apply to everyone.",
  "rules.for_students": "Rules for students",
  "rules.for_supports": "Rules for support teachers",
  "rules.settings_note":
    "The numbers follow the current settings. Change them in Settings, and the wording in Texts.",
  "rules.student.booking":
    "Booking: you can book {min_days} to {max_days} days ahead, and have one active lesson at a time.",
  "rules.student.cancel":
    "Cancelling is free if you do it at least {cancel_days} day(s) before the lesson day. After you cancel, booking stays closed for {wait_days} day(s), so think before you book.",
  "rules.student.no_move":
    "Changing the time: until the end of the day before the lesson, you can move it to another free time with Change time on Home, {moves_per_month} times a month. There is no wait and no penalty. On the lesson day it cannot be moved.",
  "rules.student.excused":
    "On the lesson day you cannot cancel. If you cannot come, tell your support teacher by chat or phone before the lesson. They can mark it as excused, with no penalty. You can have at most {excused_limit} excused lessons in 30 days.",
  "rules.student.marking":
    "A lesson counts only when you scan the code your support teacher shows after pressing Came. Do this at the latest {mark_minutes} minutes after the lesson ends. If it is not done by then, the lesson counts as missed and you get the penalty, even if you came. If you come late you can still scan until then, even if you were marked as absent. If you are told the lesson is not confirmed, remind your support teacher immediately.",
  "rules.student.closed":
    "If your support teacher closes the time of your lesson, you are told at once and offered another support teacher if one is free. There is no penalty. If this happens on the lesson day, you can book another free time that same day.",
  "rules.student.complaint":
    "If something went wrong with a lesson, use Report a problem in your history, until {complaint_deadline}. Only the center reads it.",
  "rules.student.penalty":
    "Penalties: missed lessons up to {warnings} give a warning. After that, each missed lesson closes booking for the rest of that day and {ban_days} more whole day(s): missed on Tuesday, booking opens again on Thursday at 00:00. Missed lessons stop counting after {reset_days} days.",
  "rules.student.notifications":
    "Keep notifications on. They are how you find out in time.",
  "rules.student.honesty":
    "Every mark is recorded and the center reads them. Asking for the code when you are not at the lesson, or asking for a false mark, is a serious violation.",
  "rules.support.close":
    "If you cannot come, you must close the day or the hours, as early as you can and at the latest before the lesson starts. This is your duty. If you do not come without closing the day, a student can be punished because of you. Closing on the day itself is reported to the center and counted on your account.",
  "rules.support.marking":
    'Confirm every lesson. Press "Came" when the lesson starts and show the code to the student, who scans it. "Did not come" opens {no_show_minutes} minutes after the start, and everything closes {mark_minutes} minutes after the lesson ends.',
  "rules.support.forgot":
    'If a lesson is not confirmed in time, it becomes "Missed" automatically and the student gets the penalty, even if they came. This is recorded on your account as a forgotten lesson, and it stays there even if the center corrects the lesson later.',
  "rules.support.alert":
    "{alert_minutes} minutes after the start of an unmarked lesson, you and the student are both warned.",
  "rules.support.excused":
    'Mark "Excused" only if the student really told you they cannot come, on the lesson day, and write the reason. A student can have at most {excused_limit} excused lessons in 30 days. The center is told about each one.',
  "rules.support.correct":
    'You can change your own "Did not come" or "Excused" until marking closes. After the student has scanned the code, or after marking closes, only the center can change it.',
  "rules.support.honesty":
    "Show the code only to a student who is with you. Never send it to anyone, and never mark a lesson falsely to help or to harm a student. Every mark and change is recorded with the time, and the center compares them. This is a serious violation.",
  "rules.support.notifications":
    "Keep notifications on, so you never miss a lesson or a warning.",
  "now.title": "Lesson now",
  "now.subtitle":
    "At the center and want a lesson soon? These support teachers are free for their nearest session.",
  "now.rule":
    "Send the request only when you are standing next to this support teacher. They accept it in person. The lesson is at their nearest session, {time}.",
  "now.none": "Nobody is free right now.",
  "now.ask": "Ask for a lesson now",
  "now.ask_title": "Lesson now with {name}",
  "now.topic": "Topic (optional)",
  "now.send": "Send request",
  "now.sent": "Request sent. Show it to your support teacher.",
  "now.waiting": "Waiting for {name} to accept the {time} lesson.",
  "now.cancel": "Cancel request",
  "now.accepted": "{name} accepted. Your lesson starts at {time}.",
  "now.declined":
    "{name} cannot take a lesson now. Try another support teacher.",
  "now.expired": "Your request to {name} ended without an answer. Try again.",
  "now.inbox_title": "Lesson now requests",
  "now.inbox_hint":
    "Accept only if the student is standing next to you. The lesson is at the time shown.",
  "now.accept": "Accept",
  "now.decline": "Decline",
  "now.accepted_support": "Accepted. The lesson is booked.",
  "now.declined_support": "Declined. The student is told.",
  "now.badge": "Lesson now",
  "error.INSTANT_PENDING":
    "You already have a request waiting. Cancel it or wait for the answer.",
  "error.INSTANT_EXPIRED": "This request has already ended.",
  "error.INSTANT_DISABLED": "Lessons now are turned off.",
  "error.INSTANT_BUSY": "You already have a lesson at this time.",
  "rules.student.instant":
    "Lesson now: when you are at the center, you can ask a support teacher who is at the center and free for a lesson at their nearest session. The time is rounded: asked at 16:52 or 17:10, the lesson is at 17:00; asked at 17:15, it is at 17:30. For a later time, book the usual way. Send the request only when you are standing next to them; they accept it in person. You can have at most {instant_per_day} lesson now a day, and at most {daily_minutes} minutes of lessons in one day, counting a lesson you booked for today. Bans and the wait after cancelling still apply. It is confirmed with the QR code like any other lesson.",
  "rules.support.instant":
    "Lesson now: press I'm at the center when you arrive; only then do students see you. Accept a request only when the student is standing next to you. A request ends after {instant_minutes} minutes without an answer. The lesson is at your nearest session, rounded: asked at 16:52 or 17:10, it is at 17:00; asked at 17:15, at 17:30. It is confirmed with Came and the QR code as usual.",
  "guide.student.now.title": "Lesson now, at the center",
  "guide.student.now.body":
    "If you are at the center and have time, you do not need to book in advance.\n- Open Book. Under Lesson now you see the support teachers who are at the center and free for their nearest session, with its time.\n- Go to the support teacher, then tap Ask for a lesson now and send the request while standing next to them.\n- They accept it on their phone. The lesson is at that session: asked at 16:52 or 17:10, it is at 17:00; asked at 17:15, at 17:30. Confirm it with the QR code as usual.\n- You can have {instant_per_day} lesson now a day, and at most {daily_minutes} minutes of lessons a day in total.\n- If nobody answers in {instant_minutes} minutes, the request ends and you can ask someone else. The page shows the time left.",
  "guide.support.now.title": "Lesson now requests",
  "guide.support.now.body":
    "A student at the center can ask you for a lesson at your nearest session, if you are free.\n- When you arrive, press I'm at the center on Today. Only then do students see you. It turns off by itself at the end of the day.\n- The request appears at the top of Today with the lesson time, and you get a notification.\n- Accept only if the student is standing next to you. Otherwise decline.\n- The lesson is at your nearest session: asked at 16:52 or 17:10, it is at 17:00; asked at 17:15, at 17:30. Press Came and show the code as usual.",
  "guide.admin.now.title": "Lesson now",
  "guide.admin.now.body":
    "Students at the center can ask a support teacher who is free for a lesson at their nearest session: asked at 16:52 or 17:10, it is at 17:00; asked at 17:15, at 17:30. The support teacher accepts in person.\n- These lessons are marked Lesson now in Bookings and are confirmed with the QR code like any other.\n- Turn the feature off, or change how long a request waits, in Settings.",
  "now.here_title": "Are you at the center?",
  "now.here_off":
    "Turn this on when you arrive. Only then can students ask you for a lesson now.",
  "now.here_on":
    "You are marked as at the center today. Students can ask you for a lesson now.",
  "now.here_button": "I'm at the center",
  "now.leave_button": "I left the center",
  "attend.title": "Attendance",
  "attend.card_title": "Your attendance today",
  "attend.work_time": "Work time {from}-{to}",
  "attend.no_work": "No work time today",
  "attend.scan": "Scan the QR at reception",
  "attend.scan_hint":
    "When you arrive and when you leave, scan the QR on the reception screen. Then look at your front camera for a short face check. Students can ask you for a lesson now only after you scan in.",
  "attend.status.off": "Day off",
  "attend.status.waiting": "Not scanned in yet",
  "attend.status.missing": "Late: not scanned in yet",
  "attend.status.here": "At the center",
  "attend.status.done": "Left",
  "attend.status.absent": "Absent",
  "attend.status.excused": "Excused",
  "attend.arrived": "Arrived {time}",
  "attend.left": "Left {time}",
  "attend.left_estimated": "No leaving scan: counted until {time}",
  "attend.late": "{minutes} min late",
  "attend.early": "Left {minutes} min early",
  "attend.manual": "Marked by {name}",
  "attend.history": "Last 30 days",
  "attend.no_history": "No days yet.",
  "attend.locating": "Finding your location...",
  "attend.checking": "Checking...",
  "attend.gps_needed": "Allow location for OPUS and turn on GPS, then scan again.",
  "attend.leave_confirm_title": "Leave now?",
  "attend.leave_confirm": "Your work time ends at {time}. Leaving now counts as leaving early.",
  "attend.leave_button": "Leave now",
  "attend.face_title": "Face check",
  "attend.face_loading": "Preparing the face check. The first time takes a little longer.",
  "attend.face_straight": "Look straight at the camera",
  "attend.face_turn": "Slowly turn your head to one side",
  "attend.face_turn_other": "Now turn to the other side",
  "attend.face_blink": "Blink",
  "attend.face_none": "Your face is not in the picture.",
  "attend.face_many": "Only you should be in the picture.",
  "attend.face_light": "Hold still in good light.",
  "attend.face_step": "Step {step} of {count}",
  "attend.face_no_match": "The face did not match. Tries left: {count}.",
  "attend.face_refused": "The face check did not pass. Ask reception to mark you by hand.",
  "attend.face_timeout": "The face check took too long. Try again in better light.",
  "attend.no_camera": "The camera could not be opened. Allow the camera for OPUS.",
  "attend.face_engine": "The face check could not start on this phone. Ask reception to mark you by hand.",
  "attend.try_again": "Try again",
  "attend.done_arrive": "Welcome! Arrived at {time}.",
  "attend.done_leave": "Goodbye! Left at {time}.",
  "attend.off": "Attendance is turned off.",
  "attend.no_face":
    "The developer has not uploaded your photo yet, so the face check cannot run. Ask reception to mark you by hand.",
  "attend.wrong_qr": "This is not the attendance QR. Scan the QR on the reception screen.",
  "error.INSTANT_DAILY_LIMIT": "You have already had a lesson now today.",
  "error.DAILY_TIME_LIMIT":
    "This would take you over the lesson time allowed for one day.",
  "time.starts_in": "Starts in {time}",
  "time.in_progress": "In progress",
  "time.dh": "{d} d {h} h",
  "time.hm": "{h} h {m} min",
  "time.m": "{m} min",
  "home.cancel_confirm_now":
    "Cancel your lesson with {support} on {lesson}? You can book a new lesson right away.",
  "home.cancel_effect": "If you cancel, you can book again from {date}, 00:00.",
  "home.cancel_effect_now": "If you cancel, you can book again right away.",
  "book.length": "{start}-{end} · {minutes} min",
  "book.taken_title": "Someone just took this time",
  "book.taken_pick": "These times are still free. Your topic is kept.",
  "book.taken_none":
    "Nothing else is free on this day. Close this and pick another day.",
  "chat.unavailable": "This chat is not available",
  "chat.unavailable_hint":
    "A chat opens only for your own lessons. It may belong to another lesson, or the link is wrong.",
  "today.tomorrow": "Tomorrow",
  "today.one_lesson": "1 lesson",
  "today.lesson_count": "{count} lessons",
  "complaint.status": "Where your message is",
  "complaint.step_sent": "Received",
  "complaint.step_seen": "Being reviewed",
  "complaint.step_answered": "Answered",
  "complaint.not_yet": "not yet",
  "now.at": "Lesson at {time}",
  "now.time_left": "Time left to accept:",
  "profile.theme_system": "System",
  "profile.theme_light": "Light",
  "profile.theme_dark": "Dark",
  "affected.none": "No booked lessons are affected.",
  "affected.title": "Booked lessons affected: {count}",
  "affected.transfer": "Offered another free support teacher at the same time.",
  "affected.cancel":
    "No free support teacher, so it is cancelled with no penalty.",
  "home.move": "Change time",
  "home.move_left":
    "Time changes left this month: {count}. No wait and no penalty.",
  "home.move_none": "You have used all time changes for this month.",
  "move.banner_title": "Choose a new time",
  "move.banner":
    "Your lesson with {support} on {when} moves to the time you pick. Until then it stays as it is.",
  "move.back": "Keep the current time",
  "move.confirm": "Move the lesson here",
  "move.done": "Lesson moved.",
  "error.MOVE_TOO_LATE":
    "A lesson can be moved only until the end of the day before it.",
  "error.MOVE_LIMIT": "You have used all time changes for this month.",
  "update.ready": "A new version of the app is ready.",
  "update.button": "Update",
  "today.done": "Finished today: {count}",
  "today.done_link": "See them in History",
  "first.title": "Choose your own password",
  "first.body":
    "Your password is the same as your login, so anyone who knows your name could sign in. Choose your own password to continue.",
  "error.PASSWORD_SAME_AS_LOGIN":
    "Choose a password that is different from your login.",
  "common.show_typed": "Show what you typed",
  "common.hide_typed": "Hide what you typed",
  "login.help_title": "New to the site?",
  "login.help_1":
    "Come to the {center} reception with your full name and birth year. You get a login there.",
  "login.help_2":
    "Your first password is the same as your login. After you sign in, you choose your own password.",
  "login.help_3":
    "Forgot your password? Ask at the reception. It is set back to your login, and you choose a new one again.",
  "login.help_4":
    "Add this site to your phone's home screen, so it opens like an app.",
  "error.BOOKINGS_AFFECTED_OWNER_ONLY": "This change touches booked lessons, so only the developer can make it.",
  "error.OPEN_BOOKINGS_OWNER_ONLY": "This person still has booked lessons. Only the developer can make them inactive now.",
  ...GUIDE_EN,
} as const;

export type StringKey = keyof typeof DEFAULT_STRINGS;
