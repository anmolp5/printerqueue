export type UserRole = "user" | "admin";

export type BookingStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "canceled_late"
  | "canceled_user"
  | "canceled_admin";

export interface UserProfile {
  id: string;
  microsoft_oid: string;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface CalendarBooking {
  id: string;
  user_id: string;
  user_email: string;
  user_name?: string;
  file_name: string;
  duration_minutes: number;
  buffer_minutes: number;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  reminder_minutes_before?: number | null;
  reminder_sent?: boolean;
  slot_start_notified?: boolean;
  late_warned?: boolean;
  actual_started_at?: string | null;
  actual_completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type EmailNotificationType =
  | "confirmation"
  | "pre_booking_reminder"
  | "slot_starting"
  | "print_started"
  | "print_completed"
  | "early_offer"
  | "late_cancel"
  | "late_warning"
  | "admin_override";

export interface DispatchedEmail {
  id: string;
  to: string;
  intendedRecipient?: string;
  subject: string;
  text: string;
  actionUrl?: string;
  actionLabel?: string;
  sentAt: string;
  type: EmailNotificationType;
  deliveryStatus?:
    | "sent_resend"
    | "sent_microsoft_graph"
    | "local_preview"
    | "error";
  deliveryMessage?: string;
}
