export type UserRole = 'owner' | 'partner' | 'employee';

export type DaySchedule = {
  enabled: boolean;
  open: string;
  close: string;
  lunchStart?: string;
  lunchEnd?: string;
};

export type VacationRange = {
  id: string;
  start: string;
  end: string;
  reason: string;
};

export type ShopConfig = {
  timezone: string;
  maxDays: number;
  grid: number;
  notice: number;
  buffer?: number;
  overtimeMinutes?: number;
  cancelMinutes: number;
  grace: number;
  creditFee: number;
  debitFee: number;
  city: string;
  state: string;
  address?: string;
  cep?: string;
  professional: string;
  phone: string;
  holidayDecisions?: Record<string, string>;
  week: DaySchedule[];
};

export type ShopRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  cfg: ShopConfig;
};

export type ProfessionalRow = {
  id: string;
  name: string;
  role?: UserRole;
  status?: 'active' | 'invited' | 'inactive';
  email?: string | null;
  finance?: boolean;
  commission_enabled?: boolean;
  commission_bps?: number;
  can_manage_memberships?: boolean;
  can_register_payment?: boolean;
  can_share_link?: boolean;
  preferences?: {
    notice?: number;
    buffer?: number;
    week?: DaySchedule[];
    durations?: Record<string, number>;
    disabledServices?: string[];
    holidayDecisions?: Record<string, string>;
  };
  vacations?: VacationRange[];
};

export type IdentityInfo = {
  role: UserRole;
  shop: string;
  id: string;
  name?: string;
  finance: boolean;
  commission_enabled: boolean;
  commission_bps: number;
  can_manage_memberships: boolean;
  can_register_payment: boolean;
  can_share_link: boolean;
  revoked?: boolean;
};

export type ServiceRow = {
  id: string;
  name: string;
  price: number;
  duration: number;
  active: boolean;
};

export type ClientRow = {
  id: string;
  name: string;
  phone: string;
  user_id?: string | null;
  created_at?: string;
};

export type AppointmentServiceItem = {
  id: string;
  name: string;
  duration: number;
  price: number;
};

export type AppointmentRow = {
  id: string;
  client: string;
  professional: string;
  starts: string;
  ends: string;
  services: AppointmentServiceItem[];
  price: number;
  status: 'booked' | 'done' | 'cancelled' | 'absent';
  membership?: string | null;
};

export type ChargeRow = {
  id: string;
  client?: string | null;
  appointment?: string | null;
  membership?: string | null;
  description: string;
  amount: number;
  direction: 'in' | 'out';
  category: string;
  due?: string | null;
  month?: string | null;
  created_at?: string;
};

export type PaymentRow = {
  id: string;
  charge: string;
  amount: number;
  fee: number;
  method: 'pix' | 'cash' | 'credit' | 'debit' | string;
  paid_on: string;
  settles_on: string;
};

export type MembershipRow = {
  id: string;
  client: string;
  professional: string;
  service_ids: string[];
  weekday: number;
  at_time: string;
  price: number;
  due_day: number;
  active: boolean;
};

export type BlockRow = {
  id: string;
  starts: string;
  ends: string;
  reason?: string;
};

export type RecurringRow = {
  id: string;
  name: string;
  amount: number;
  day: number;
  variable: boolean;
  active: boolean;
};

export type WorkspaceData = {
  onboarding?: boolean;
  shop: ShopRow;
  professionals: ProfessionalRow[];
  services: ServiceRow[];
  clients: ClientRow[];
  appointments: AppointmentRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
  memberships: MembershipRow[];
  blocks: BlockRow[];
  recurring: RecurringRow[];
};

export type ApiCallFn = (action: string, payload?: Record<string, unknown>) => Promise<unknown>;

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Proprietário',
  partner: 'Sócio',
  employee: 'Colaborador',
};

export const METHOD_LABELS: Record<string, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
};

export const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
