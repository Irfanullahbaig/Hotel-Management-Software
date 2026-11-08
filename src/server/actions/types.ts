export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  redirectTo?: string;
  data?: Record<string, unknown>;
} | null;
