'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Percent, Plus } from 'lucide-react';
import { cents, money, today } from '@/lib/domain';
import {
  METHOD_LABELS,
  type ApiCallFn,
  type AppointmentRow,
  type ChargeRow,
  type IdentityInfo,
  type PaymentRow,
  type ProfessionalRow,
  type ShopConfig,
} from './types';

type CommissionItem = {
  id: string;
  professional: string;
  name: string;
  appointment: string;
  starts?: string;
  basis: number;
  commission: number;
  day: string;
  rules: Array<{ service: string; name: string; price: number; rate: number; amount: number }>;
  paid: number;
};

type CommissionPayout = {
  id: string;
  professional: string;
  name: string;
  amount: number;
  paid_on: string;
  note: string;
};

type ReportsPanelProps = {
  appointments: AppointmentRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
  professionals: ProfessionalRow[];
  cfg: ShopConfig;
  identity: IdentityInfo;
  isTeam: boolean;
  call: ApiCallFn;
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

export function ReportsPanel({
  appointments,
  charges,
  payments,
  professionals,
  cfg,
  identity,
  isTeam,
  call,
}: ReportsPanelProps) {
  const isManager = identity.role === 'owner' || identity.role === 'partner';
  const nowDay = today();
  const defaultFrom = nowDay.slice(0, 8) + '01';

  const [tab, setTab] = useState<'general' | 'commission'>(
    isManager ? 'general' : 'commission'
  );
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(nowDay);
  const [selectedProf, setSelectedProf] = useState<string>(
    isManager ? 'all' : identity.id
  );

  // Commission report state
  const [commProf, setCommProf] = useState<string>(
    isManager ? professionals.find(p => p.commission_enabled)?.id || professionals[0]?.id || '' : identity.id
  );
  const [commFrom, setCommFrom] = useState(defaultFrom);
  const [commTo, setCommTo] = useState(nowDay);
  const [commData, setCommData] = useState<{ items: CommissionItem[]; payouts: CommissionPayout[] }>({
    items: [],
    payouts: [],
  });
  const [commLoading, setCommLoading] = useState(false);
  const [commError, setCommError] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutNote, setPayoutNote] = useState('');
  const [payoutDate, setPayoutDate] = useState(nowDay);
  const [payoutMsg, setPayoutMsg] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);

  const loadCommission = useCallback(async () => {
    if (!isManager && !identity.commission_enabled) return;
    setCommLoading(true);
    setCommError('');
    try {
      const payload: Record<string, unknown> = { from: commFrom, to: commTo };
      if (isManager && commProf && commProf !== 'all') payload.professional = commProf;
      const res = (await call('manage:earnings', payload)) as {
        items?: CommissionItem[];
        payouts?: CommissionPayout[];
      };
      setCommData({
        items: Array.isArray(res?.items) ? res.items : [],
        payouts: Array.isArray(res?.payouts) ? res.payouts : [],
      });
    } catch (e) {
      setCommError(e instanceof Error ? e.message : 'Não foi possível carregar comissões.');
    } finally {
      setCommLoading(false);
    }
  }, [call, commFrom, commTo, commProf, isManager, identity.commission_enabled]);

  useEffect(() => {
    if (tab === 'commission') {
      loadCommission();
    }
  }, [tab, loadCommission]);

  // General report calculations (current period + previous period comparison)
  const generalMetrics = useMemo(() => {
    const spanDays = Math.max(
      1,
      Math.round((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / 86400000) + 1
    );
    const prevTo = addDaysYmd(from, -1);
    const prevFrom = addDaysYmd(prevTo, -(spanDays - 1));

    const aptMap = new Map(appointments.map(a => [a.id, a]));
    const chargeMap = new Map(charges.map(c => [c.id, c]));

    const matchProf = (profId?: string | null) =>
      !isTeam || selectedProf === 'all' || profId === selectedProf;

    const calcWindow = (start: string, end: string) => {
      const winApts = appointments.filter(a => {
        const d = a.starts.slice(0, 10);
        return d >= start && d <= end && matchProf(a.professional);
      });
      const done = winApts.filter(a => a.status === 'done');
      const cancelled = winApts.filter(a => a.status === 'cancelled').length;
      const absent = winApts.filter(a => a.status === 'absent').length;
      const serviceCount = done.reduce((s, a) => s + (a.services?.length || 1), 0);

      let gross = 0;
      let fees = 0;
      const methods: Record<string, number> = { pix: 0, cash: 0, credit: 0, debit: 0 };

      for (const p of payments) {
        if (p.paid_on < start || p.paid_on > end) continue;
        const ch = chargeMap.get(p.charge);
        if (!ch || ch.direction !== 'in' || ['sale', 'stock_purchase'].includes(ch.category)) continue;
        const apt = ch.appointment ? aptMap.get(ch.appointment) : undefined;
        if (selectedProf !== 'all' && apt?.professional !== selectedProf) continue;
        gross += p.amount;
        fees += p.fee || 0;
        methods[p.method] = (methods[p.method] || 0) + p.amount;
      }

      const paidByCh = new Map<string, number>();
      for (const p of payments) paidByCh.set(p.charge, (paidByCh.get(p.charge) || 0) + p.amount);
      const pending = charges
        .filter(c => {
          if (c.direction !== 'in' || ['sale', 'stock_purchase'].includes(c.category)) return false;
          const ref = (c.due || c.created_at || '').slice(0, 10);
          if (ref < start || ref > end) return false;
          const apt = c.appointment ? aptMap.get(c.appointment) : undefined;
          return selectedProf === 'all' || apt?.professional === selectedProf;
        })
        .reduce((s, c) => s + Math.max(0, c.amount - (paidByCh.get(c.id) || 0)), 0);

      return {
        doneCount: done.length,
        serviceCount,
        cancelled,
        absent,
        gross,
        fees,
        net: gross - fees,
        pending,
        methods,
      };
    };

    const current = calcWindow(from, to);
    const previous = calcWindow(prevFrom, prevTo);
    const deltaPct =
      previous.net > 0 ? Math.round(((current.net - previous.net) / previous.net) * 100) : null;

    // Per-professional breakdown
    const byProf = professionals.map(pr => {
      const pApts = appointments.filter(
        a => a.professional === pr.id && a.status === 'done' && a.starts.slice(0, 10) >= from && a.starts.slice(0, 10) <= to
      );
      const billed = pApts.reduce((s, a) => s + a.price, 0);
      return { id: pr.id, name: pr.name, count: pApts.length, billed };
    });

    return { current, previous, deltaPct, byProf, prevFrom, prevTo };
  }, [appointments, charges, payments, professionals, from, to, selectedProf, isTeam]);

  const commTotals = useMemo(() => {
    const basis = commData.items.reduce((s, i) => s + i.basis, 0);
    const earned = commData.items.reduce((s, i) => s + i.commission, 0);
    const paidOut = commData.payouts.reduce((s, p) => s + p.amount, 0);
    return { basis, earned, paidOut, balance: Math.max(0, earned - paidOut) };
  }, [commData]);

  async function handleRegisterPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!commProf || commProf === 'all') {
      setCommError('Selecione um profissional específico para registrar o pagamento.');
      return;
    }
    const amountCents = cents(payoutAmount);
    if (!amountCents || amountCents <= 0) {
      setCommError('Informe um valor válido.');
      return;
    }
    setPayoutBusy(true);
    setCommError('');
    setPayoutMsg('');
    try {
      await call('manage:commission_payout', {
        professional: commProf,
        amount: amountCents,
        paid_on: payoutDate,
        note: payoutNote,
        request_id: crypto.randomUUID(),
      });
      setPayoutAmount('');
      setPayoutNote('');
      setPayoutMsg('Pagamento de comissão registrado.');
      await loadCommission();
    } catch (err) {
      setCommError(err instanceof Error ? err.message : 'Falha ao registrar pagamento.');
    } finally {
      setPayoutBusy(false);
    }
  }

  return (
    <section className="kr-module">
      <div className="kr-module-head">
        <div>
          <h2>Relatórios</h2>
          <p className="kr-sub">
            {isManager
              ? 'Desempenho operacional, comparativo de períodos e apuração individual de comissões.'
              : 'Consulte sua apuração individual de comissões e repasses por período.'}
          </p>
        </div>
      </div>

      {isManager && (
        <div className="kr-view-tabs" role="tablist" aria-label="Tipo de relatório">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'general'}
            className={`kr-pill-tab ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >
            <BarChart3 size={15} /> Relatório geral
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'commission'}
            className={`kr-pill-tab ${tab === 'commission' ? 'active' : ''}`}
            onClick={() => setTab('commission')}
          >
            <Percent size={15} /> Relatório de comissão
          </button>
        </div>
      )}

      {tab === 'general' && isManager && (
        <>
          <div className="kr-date-range card">
            <label>
              Data inicial
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
            {isTeam && (
              <label>
                Profissional
                <select value={selectedProf} onChange={e => setSelectedProf(e.target.value)}>
                  <option value="all">Visão geral da barbearia</option>
                  {professionals.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="kr-kpi-grid">
            <article className="card kr-kpi">
              <span>Atendimentos concluídos</span>
              <strong className="mono">{generalMetrics.current.doneCount}</strong>
              <small>
                {generalMetrics.current.serviceCount} serviços · {generalMetrics.current.cancelled} canc. · {generalMetrics.current.absent} faltas
              </small>
            </article>
            <article className="card kr-kpi">
              <span>Faturamento bruto</span>
              <strong className="mono">{money(generalMetrics.current.gross)}</strong>
              <small>Período anterior: {money(generalMetrics.previous.gross)}</small>
            </article>
            <article className="card kr-kpi">
              <span>Taxas e líquido</span>
              <strong className="mono emerald-text">{money(generalMetrics.current.net)}</strong>
              <small>
                Taxas: {money(generalMetrics.current.fees)}
                {generalMetrics.deltaPct !== null &&
                  ` · ${generalMetrics.deltaPct >= 0 ? '+' : ''}${generalMetrics.deltaPct}% vs período anterior`}
              </small>
            </article>
            <article className="card kr-kpi">
              <span>Pendências no período</span>
              <strong className="mono warn-text">{money(generalMetrics.current.pending)}</strong>
              <small>Valores ainda não recebidos</small>
            </article>
          </div>

          <div className="card kr-list-card">
            <h3>Formas de pagamento</h3>
            <div className="kr-method-grid">
              {(['pix', 'cash', 'credit', 'debit'] as const).map(m => (
                <div key={m} className="kr-method-item">
                  <span>{METHOD_LABELS[m]}</span>
                  <strong className="mono">{money(generalMetrics.current.methods[m] || 0)}</strong>
                </div>
              ))}
            </div>
          </div>

          {isTeam && (
            <div className="card kr-list-card">
              <h3>Desempenho por profissional</h3>
              <div className="kr-table-wrap">
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>Profissional</th>
                      <th className="num">Atendimentos</th>
                      <th className="num">Serviços faturados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generalMetrics.byProf.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.name}</strong></td>
                        <td className="num mono">{row.count}</td>
                        <td className="num mono">{money(row.billed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'commission' && (
        <>
          {!isManager && !identity.commission_enabled ? (
            <div className="card">
              <p className="empty-state">
                A comissão individual não está habilitada para o seu perfil. Fale com a gestão da barbearia.
              </p>
            </div>
          ) : (
            <>
              <div className="kr-date-range card">
                {isManager && (
                  <label>
                    Funcionário
                    <select value={commProf} onChange={e => setCommProf(e.target.value)}>
                      <option value="all">Todos os profissionais</option>
                      {professionals.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.commission_enabled
                            ? ` (${((p.commission_bps || 0) / 100).toFixed(0)}%)`
                            : ' (sem comissão)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Data inicial
                  <input type="date" value={commFrom} onChange={e => setCommFrom(e.target.value)} />
                </label>
                <label>
                  Data final
                  <input type="date" value={commTo} onChange={e => setCommTo(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={commLoading}
                  onClick={loadCommission}
                >
                  {commLoading ? 'Gerando...' : 'Gerar relatório'}
                </button>
              </div>

              {commError && <p role="alert" className="notice danger">{commError}</p>}
              {payoutMsg && (
                <p role="status" className="notice success-notice">
                  <CheckCircle2 size={15} /> {payoutMsg}
                </p>
              )}

              <div className="kr-kpi-grid">
                <article className="card kr-kpi">
                  <span>Serviços (base)</span>
                  <strong className="mono">{money(commTotals.basis)}</strong>
                  <small>{commData.items.length} atendimentos com comissão</small>
                </article>
                <article className="card kr-kpi">
                  <span>Comissão gerada</span>
                  <strong className="mono emerald-text">{money(commTotals.earned)}</strong>
                  <small>Percentual gravado no atendimento</small>
                </article>
                <article className="card kr-kpi">
                  <span>Pagamentos realizados</span>
                  <strong className="mono">{money(commTotals.paidOut)}</strong>
                  <small>{commData.payouts.length} repasse(s) no período</small>
                </article>
                <article className="card kr-kpi">
                  <span>Saldo pendente</span>
                  <strong className={`mono ${commTotals.balance > 0 ? 'warn-text' : 'emerald-text'}`}>
                    {money(commTotals.balance)}
                  </strong>
                  <small>A repassar no período</small>
                </article>
              </div>

              {isManager && commProf && commProf !== 'all' && (
                <form className="card kr-inline-form" onSubmit={handleRegisterPayout}>
                  <h3>Registrar pagamento de comissão (total ou parcial)</h3>
                  <div className="kr-form-row">
                    <label>
                      Valor (R$)
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Ex.: 150,00"
                        value={payoutAmount}
                        onChange={e => setPayoutAmount(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Data do pagamento
                      <input
                        type="date"
                        value={payoutDate}
                        onChange={e => setPayoutDate(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Observação
                      <input
                        type="text"
                        placeholder="Pix, adiantamento, fechamento semanal..."
                        value={payoutNote}
                        onChange={e => setPayoutNote(e.target.value)}
                      />
                    </label>
                    <button type="submit" className="btn primary" disabled={payoutBusy}>
                      <Plus size={15} /> Registrar repasse
                    </button>
                  </div>
                </form>
              )}

              <div className="card kr-list-card">
                <h3>Serviços e comissões geradas</h3>
                {commData.items.length === 0 ? (
                  <p className="empty-state">Nenhuma comissão gerada neste período.</p>
                ) : (
                  <div className="kr-table-wrap">
                    <table className="kr-table">
                      <thead>
                        <tr>
                          <th>Data</th>
                          {isManager && <th>Profissional</th>}
                          <th>Serviços / % aplicada</th>
                          <th className="num">Base</th>
                          <th className="num">Comissão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commData.items.map(item => (
                          <tr key={item.id}>
                            <td>{formatBrDate(item.starts || item.day)}</td>
                            {isManager && <td><strong>{item.name}</strong></td>}
                            <td>
                              {(item.rules || []).map((r, i) => (
                                <div key={i} className="kr-cell-sub">
                                  {r.name} · {money(r.price)} × {(r.rate / 100).toFixed(0)}% ={' '}
                                  <strong>{money(r.amount)}</strong>
                                </div>
                              ))}
                            </td>
                            <td className="num mono">{money(item.basis)}</td>
                            <td className="num mono emerald-text">
                              <strong>{money(item.commission)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {commData.payouts.length > 0 && (
                <div className="card kr-list-card">
                  <h3>Repasses registrados</h3>
                  <div className="kr-table-wrap">
                    <table className="kr-table">
                      <thead>
                        <tr>
                          <th>Data</th>
                          {isManager && <th>Profissional</th>}
                          <th>Observação</th>
                          <th className="num">Valor pago</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commData.payouts.map(p => (
                          <tr key={p.id}>
                            <td>{formatBrDate(p.paid_on)}</td>
                            {isManager && <td><strong>{p.name}</strong></td>}
                            <td>{p.note || 'Repasse de comissão'}</td>
                            <td className="num mono"><strong>{money(p.amount)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
