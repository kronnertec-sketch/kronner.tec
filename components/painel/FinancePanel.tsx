'use client';

import { useMemo, useState } from 'react';
import { Calendar, Plus, Repeat } from 'lucide-react';
import { money, today } from '@/lib/domain';
import {
  METHOD_LABELS,
  type AppointmentRow,
  type ChargeRow,
  type ClientRow,
  type IdentityInfo,
  type MembershipRow,
  type PaymentRow,
  type ProfessionalRow,
  type ShopConfig,
} from './types';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

type FinancePanelProps = {
  charges: ChargeRow[];
  payments: PaymentRow[];
  appointments: AppointmentRow[];
  memberships: MembershipRow[];
  clients: ClientRow[];
  professionals: ProfessionalRow[];
  cfg: ShopConfig;
  identity: IdentityInfo;
  isTeam: boolean;
  onNewCharge: () => void;
  onGenerateExpenses: () => void;
  onReceiveCharge: (charge: ChargeRow) => void;
};

function addDaysYmd(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatBrDate(ymd?: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

export function FinancePanel({
  charges,
  payments,
  appointments,
  memberships,
  clients,
  professionals,
  cfg,
  identity,
  isTeam,
  onNewCharge,
  onGenerateExpenses,
  onReceiveCharge,
}: FinancePanelProps) {
  const nowDay = today();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState(nowDay.slice(0, 8) + '01');
  const [customTo, setCustomTo] = useState(nowDay);

  const isManager = identity.role === 'owner' || identity.role === 'partner';
  const canPay = isManager || identity.can_register_payment;
  const [scope, setScope] = useState<string>(isManager ? 'all' : identity.id);

  const range = useMemo(() => {
    if (preset === 'today') return { from: nowDay, to: nowDay };
    if (preset === 'week') return { from: addDaysYmd(nowDay, -6), to: nowDay };
    if (preset === 'month') return { from: nowDay.slice(0, 8) + '01', to: nowDay };
    return {
      from: customFrom <= customTo ? customFrom : customTo,
      to: customTo >= customFrom ? customTo : customFrom,
    };
  }, [preset, nowDay, customFrom, customTo]);

  const aptMap = useMemo(() => new Map(appointments.map(a => [a.id, a])), [appointments]);
  const memMap = useMemo(() => new Map(memberships.map(m => [m.id, m])), [memberships]);
  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients]);
  const chargeMap = useMemo(() => new Map(charges.map(c => [c.id, c])), [charges]);

  // Exclude product/stock legacy categories from active service finance
  const serviceCharges = useMemo(
    () =>
      charges.filter(c => {
        if (['sale', 'stock_purchase'].includes(c.category)) return false;
        if (!isManager || scope !== 'all') {
          const targetProf = isManager ? scope : identity.id;
          const apt = c.appointment ? aptMap.get(c.appointment) : undefined;
          const mem = c.membership ? memMap.get(c.membership) : undefined;
          return apt?.professional === targetProf || mem?.professional === targetProf;
        }
        return true;
      }),
    [charges, isManager, scope, identity.id, aptMap, memMap]
  );

  const allowedChargeIds = useMemo(
    () => new Set(serviceCharges.map(c => c.id)),
    [serviceCharges]
  );

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge, (map.get(p.charge) || 0) + p.amount);
    }
    return map;
  }, [payments]);

  const periodPayments = useMemo(
    () =>
      payments.filter(
        p =>
          allowedChargeIds.has(p.charge) &&
          p.paid_on >= range.from &&
          p.paid_on <= range.to
      ),
    [payments, allowedChargeIds, range]
  );

  const metrics = useMemo(() => {
    let grossIn = 0;
    let fees = 0;
    let expensesPaid = 0;
    const byMethod: Record<string, { gross: number; fee: number; net: number }> = {
      pix: { gross: 0, fee: 0, net: 0 },
      cash: { gross: 0, fee: 0, net: 0 },
      credit: { gross: 0, fee: 0, net: 0 },
      debit: { gross: 0, fee: 0, net: 0 },
    };

    for (const p of periodPayments) {
      const ch = chargeMap.get(p.charge);
      if (!ch) continue;
      if (ch.direction === 'in') {
        grossIn += p.amount;
        fees += p.fee || 0;
        const m = byMethod[p.method] || { gross: 0, fee: 0, net: 0 };
        m.gross += p.amount;
        m.fee += p.fee || 0;
        m.net += p.amount - (p.fee || 0);
        byMethod[p.method] = m;
      } else {
        expensesPaid += p.amount;
      }
    }

    const netIn = grossIn - fees;
    const pendingIn = serviceCharges
      .filter(c => c.direction === 'in')
      .reduce((sum, c) => sum + Math.max(0, c.amount - (paidByCharge.get(c.id) || 0)), 0);

    return {
      grossIn,
      fees,
      netIn,
      expensesPaid,
      balance: netIn - expensesPaid,
      pendingIn,
      byMethod,
    };
  }, [periodPayments, chargeMap, serviceCharges, paidByCharge]);

  const periodCharges = useMemo(
    () =>
      serviceCharges
        .filter(c => {
          const refDate = (c.due || c.created_at || nowDay).slice(0, 10);
          return refDate >= range.from && refDate <= range.to;
        })
        .sort((a, b) => (b.due || b.created_at || '').localeCompare(a.due || a.created_at || '')),
    [serviceCharges, range, nowDay]
  );

  return (
    <section className="kr-module">
      <div className="kr-module-head">
        <div>
          <h2>Financeiro de serviços</h2>
          <p className="kr-sub">
            Entradas de atendimentos, mensalidades, taxas de maquininha e despesas operacionais.
          </p>
        </div>
        {isManager && (
          <div className="kr-actions-row">
            <button type="button" className="btn" onClick={onGenerateExpenses}>
              <Repeat size={15} /> Gerar fixas do mês
            </button>
            <button type="button" className="btn primary" onClick={onNewCharge}>
              <Plus size={16} /> Novo lançamento
            </button>
          </div>
        )}
      </div>

      <div className="kr-filter-bar">
        <div className="kr-view-tabs" role="group" aria-label="Período financeiro">
          {(
            [
              ['today', 'Hoje'],
              ['week', 'Últimos 7 dias'],
              ['month', 'Este mês'],
              ['custom', 'Personalizado'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`kr-pill-tab ${preset === id ? 'active' : ''}`}
              onClick={() => setPreset(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {isTeam && isManager && (
          <label className="kr-inline-select">
            <span>Visão</span>
            <select value={scope} onChange={e => setScope(e.target.value)}>
              <option value="all">Financeiro geral</option>
              <option value={identity.id}>Meu financeiro</option>
              {professionals
                .filter(p => p.id !== identity.id)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {preset === 'custom' && (
        <div className="kr-date-range card">
          <Calendar size={16} />
          <label>
            De
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}

      <div className="kr-kpi-grid">
        <article className="card kr-kpi">
          <span>Recebido bruto</span>
          <strong className="mono">{money(metrics.grossIn)}</strong>
          <small>
            {formatBrDate(range.from)} a {formatBrDate(range.to)}
          </small>
        </article>
        <article className="card kr-kpi">
          <span>Taxas de cartão</span>
          <strong className="mono warn-text">{money(metrics.fees)}</strong>
          <small>
            Crédito {(cfg.creditFee / 100).toFixed(2)}% · Débito {(cfg.debitFee / 100).toFixed(2)}%
          </small>
        </article>
        <article className="card kr-kpi">
          <span>Recebido líquido</span>
          <strong className="mono emerald-text">{money(metrics.netIn)}</strong>
          <small>Após taxas de maquininha</small>
        </article>
        <article className="card kr-kpi">
          <span>A receber (aberto)</span>
          <strong className="mono">{money(metrics.pendingIn)}</strong>
          <small>Atendimentos e mensalidades pendentes</small>
        </article>
        {isManager && scope === 'all' && (
          <>
            <article className="card kr-kpi">
              <span>Saídas pagas</span>
              <strong className="mono danger-text">{money(metrics.expensesPaid)}</strong>
              <small>Despesas e retiradas no período</small>
            </article>
            <article className="card kr-kpi">
              <span>Saldo do período</span>
              <strong className={`mono ${metrics.balance >= 0 ? 'emerald-text' : 'danger-text'}`}>
                {money(metrics.balance)}
              </strong>
              <small>Líquido menos saídas</small>
            </article>
          </>
        )}
      </div>

      <div className="card kr-list-card">
        <h3>Recebimentos por forma de pagamento</h3>
        <div className="kr-method-grid">
          {(['pix', 'cash', 'credit', 'debit'] as const).map(method => {
            const row = metrics.byMethod[method];
            return (
              <div key={method} className="kr-method-item">
                <span>{METHOD_LABELS[method]}</span>
                <strong className="mono">{money(row.net)}</strong>
                <small className="mono">
                  Bruto {money(row.gross)} · Taxa {money(row.fee)}
                </small>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card kr-list-card">
        <h3>Lançamentos do período</h3>
        {periodCharges.length === 0 ? (
          <p className="empty-state">Nenhum lançamento de serviço no período selecionado.</p>
        ) : (
          <div className="kr-table-wrap">
            <table className="kr-table">
              <thead>
                <tr>
                  <th>Descrição / Cliente</th>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th className="num">Valor</th>
                  <th className="num">Situação</th>
                </tr>
              </thead>
              <tbody>
                {periodCharges.map(ch => {
                  const paid = paidByCharge.get(ch.id) || 0;
                  const remaining = Math.max(0, ch.amount - paid);
                  const cName = ch.client ? clientMap.get(ch.client) : null;
                  return (
                    <tr key={ch.id}>
                      <td>
                        <strong>{ch.description}</strong>
                        {cName && <div className="kr-cell-sub">{cName}</div>}
                      </td>
                      <td>{formatBrDate(ch.due || ch.created_at)}</td>
                      <td>
                        <span className={`kr-tag ${ch.direction === 'in' ? 'emerald' : 'danger'}`}>
                          {ch.direction === 'in' ? 'Entrada' : 'Saída'}
                        </span>
                      </td>
                      <td className="num mono">
                        <strong>{money(ch.amount)}</strong>
                        {paid > 0 && remaining > 0 && (
                          <div className="kr-cell-sub">Pago {money(paid)}</div>
                        )}
                      </td>
                      <td className="num">
                        {remaining === 0 ? (
                          <span className="kr-tag emerald">Pago</span>
                        ) : canPay ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => onReceiveCharge(ch)}
                          >
                            {ch.direction === 'in' ? 'Receber' : 'Pagar'} ({money(remaining)})
                          </button>
                        ) : (
                          <span className="kr-tag warn">Pendente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
