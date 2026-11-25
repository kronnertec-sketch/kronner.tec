'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  MessageCircle,
  Search,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { debtStatus, money, today } from '@/lib/domain';
import type {
  AppointmentRow,
  ChargeRow,
  ClientRow,
  IdentityInfo,
  MembershipRow,
  PaymentRow,
  ProfessionalRow,
  ShopConfig,
} from './types';

type ClientView = 'all' | 'pending' | 'overdue' | 'inactive30';

type ClientsPanelProps = {
  clients: ClientRow[];
  appointments: AppointmentRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
  memberships: MembershipRow[];
  professionals: ProfessionalRow[];
  cfg: ShopConfig;
  identity: IdentityInfo;
  onNewClient: () => void;
  onReceiveCharge: (charge: ChargeRow) => void;
};

function daysBetween(olderYmd: string, newerYmd: string): number {
  const a = new Date(olderYmd + 'T12:00:00Z').getTime();
  const b = new Date(newerYmd + 'T12:00:00Z').getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function formatBrDate(ymd?: string | null): string {
  if (!ymd) return '—';
  const clean = ymd.slice(0, 10);
  const [y, m, d] = clean.split('-');
  return d && m && y ? `${d}/${m}/${y}` : clean;
}

export function ClientsPanel({
  clients,
  appointments,
  charges,
  payments,
  memberships,
  professionals,
  cfg,
  identity,
  onNewClient,
  onReceiveCharge,
}: ClientsPanelProps) {
  const [view, setView] = useState<ClientView>('all');
  const [query, setQuery] = useState('');

  const isManager = identity.role === 'owner' || identity.role === 'partner';
  const canSeeFinance = isManager || identity.finance;
  const canPay = isManager || identity.can_register_payment;
  const nowDay = today();

  const profMap = useMemo(
    () => new Map(professionals.map(p => [p.id, p.name])),
    [professionals]
  );

  const aptMap = useMemo(
    () => new Map(appointments.map(a => [a.id, a])),
    [appointments]
  );

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge, (map.get(p.charge) || 0) + p.amount);
    }
    return map;
  }, [payments]);

  // Last completed appointment across the ENTIRE barbershop per client (never binds client to a barber)
  const lastDoneByClient = useMemo(() => {
    const map = new Map<
      string,
      { day: string; services: string; professionalName: string; count: number }
    >();
    for (const a of appointments) {
      if (a.status !== 'done') continue;
      const day = a.starts.slice(0, 10);
      const prev = map.get(a.client);
      const svcText = (a.services || []).map(s => s.name).join(', ') || 'Atendimento';
      const pName = profMap.get(a.professional) || 'Profissional';
      if (!prev || day > prev.day) {
        map.set(a.client, {
          day,
          services: svcText,
          professionalName: pName,
          count: (prev?.count || 0) + 1,
        });
      } else {
        map.set(a.client, { ...prev, count: prev.count + 1 });
      }
    }
    return map;
  }, [appointments, profMap]);

  // Active memberships per client (only memberships carry a responsible professional)
  const membershipByClient = useMemo(() => {
    const map = new Map<string, MembershipRow>();
    for (const m of memberships) {
      if (m.active) map.set(m.client, m);
    }
    return map;
  }, [memberships]);

  // Open incoming charges categorized into:
  // B) Pending after completed service (not yet overdue)
  // C) Overdue (past due + grace)
  const { pendingRows, overdueRows } = useMemo(() => {
    const pending: Array<{
      client: ClientRow;
      charge: ChargeRow;
      remaining: number;
      date: string;
      serviceName: string;
      professionalName: string;
    }> = [];
    const overdue: Array<{
      client: ClientRow;
      charge: ChargeRow;
      remaining: number;
      dueDate: string;
      daysLate: number;
      professionalName: string;
    }> = [];

    if (!canSeeFinance) return { pendingRows: pending, overdueRows: overdue };

    const clientMap = new Map(clients.map(c => [c.id, c]));
    for (const ch of charges) {
      if (ch.direction !== 'in' || !ch.client) continue;
      const client = clientMap.get(ch.client);
      if (!client) continue;
      const paid = paidByCharge.get(ch.id) || 0;
      const remaining = ch.amount - paid;
      if (remaining <= 0) continue;

      const apt = ch.appointment ? aptMap.get(ch.appointment) : undefined;
      const status = debtStatus(ch.amount, paid, ch.due || nowDay, cfg.grace || 0, nowDay);
      const profName = apt
        ? profMap.get(apt.professional) || 'Barbearia'
        : ch.membership
          ? profMap.get(membershipByClient.get(client.id)?.professional || '') || 'Barbearia'
          : 'Barbearia';

      if (status === 'Atrasado') {
        const dueDate = ch.due || nowDay;
        overdue.push({
          client,
          charge: ch,
          remaining,
          dueDate,
          daysLate: daysBetween(dueDate, nowDay),
          professionalName: profName,
        });
      } else if (apt && apt.status === 'done') {
        pending.push({
          client,
          charge: ch,
          remaining,
          date: apt.starts.slice(0, 10),
          serviceName: (apt.services || []).map(s => s.name).join(', ') || ch.description,
          professionalName: profName,
        });
      }
    }

    pending.sort((a, b) => b.date.localeCompare(a.date));
    overdue.sort((a, b) => b.daysLate - a.daysLate);
    return { pendingRows: pending, overdueRows: overdue };
  }, [canSeeFinance, clients, charges, paidByCharge, aptMap, nowDay, cfg.grace, profMap, membershipByClient]);

  // D) Clients with > 30 days without a completed cut across the whole barbershop
  const inactive30Rows = useMemo(() => {
    const list: Array<{
      client: ClientRow;
      lastDay: string;
      daysAway: number;
      lastService: string;
      lastProfessional: string;
    }> = [];

    for (const client of clients) {
      const last = lastDoneByClient.get(client.id);
      if (!last) continue;
      const diff = daysBetween(last.day, nowDay);
      if (diff >= 30) {
        list.push({
          client,
          lastDay: last.day,
          daysAway: diff,
          lastService: last.services,
          lastProfessional: last.professionalName,
        });
      }
    }
    list.sort((a, b) => b.daysAway - a.daysAway);
    return list;
  }, [clients, lastDoneByClient, nowDay]);

  const q = query.trim().toLowerCase();
  const matchClient = (c: ClientRow) =>
    !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);

  const filteredAll = useMemo(
    () =>
      clients
        .filter(matchClient)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, q]
  );

  const filteredPending = pendingRows.filter(r => matchClient(r.client));
  const filteredOverdue = overdueRows.filter(r => matchClient(r.client));
  const filteredInactive = inactive30Rows.filter(r => matchClient(r.client));

  return (
    <section className="kr-module">
      <div className="kr-module-head">
        <div>
          <h2>Base de clientes da barbearia</h2>
          <p className="kr-sub">
            Todos os clientes pertencem à barbearia e podem ser atendidos por qualquer profissional.
            Apenas mensalistas mantêm vínculo de responsabilidade.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={onNewClient}>
          <UserPlus size={16} /> Novo cliente
        </button>
      </div>

      <div className="kr-view-tabs" role="tablist" aria-label="Visualizações de clientes">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'all'}
          className={`kr-pill-tab ${view === 'all' ? 'active' : ''}`}
          onClick={() => setView('all')}
        >
          <Users size={15} /> Todos os clientes
          <span className="kr-badge">{clients.length}</span>
        </button>

        {canSeeFinance && (
          <button
            type="button"
            role="tab"
            aria-selected={view === 'pending'}
            className={`kr-pill-tab ${view === 'pending' ? 'active' : ''}`}
            onClick={() => setView('pending')}
          >
            <Wallet size={15} /> Pendentes de pagamento
            <span className="kr-badge warn">{pendingRows.length}</span>
          </button>
        )}

        {canSeeFinance && (
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overdue'}
            className={`kr-pill-tab ${view === 'overdue' ? 'active' : ''}`}
            onClick={() => setView('overdue')}
          >
            <AlertTriangle size={15} /> Pagamento atrasado
            <span className="kr-badge danger">{overdueRows.length}</span>
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={view === 'inactive30'}
          className={`kr-pill-tab ${view === 'inactive30' ? 'active' : ''}`}
          onClick={() => setView('inactive30')}
        >
          <Clock size={15} /> +30 dias sem cortar
          <span className="kr-badge">{inactive30Rows.length}</span>
        </button>
      </div>

      <div className="kr-search-bar">
        <Search size={16} />
        <input
          type="search"
          placeholder="Buscar por nome ou telefone..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {view === 'all' && (
        <div className="card kr-list-card">
          {filteredAll.length === 0 ? (
            <p className="empty-state">Nenhum cliente encontrado.</p>
          ) : (
            <div className="kr-table-wrap">
              <table className="kr-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Último atendimento</th>
                    <th>Status / Plano</th>
                    <th className="num">Contato</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.map(client => {
                    const last = lastDoneByClient.get(client.id);
                    const mem = membershipByClient.get(client.id);
                    const memProf = mem ? profMap.get(mem.professional) : null;
                    const digits = (client.phone || '').replace(/\D/g, '');
                    return (
                      <tr key={client.id}>
                        <td>
                          <strong>{client.name}</strong>
                          <div className="kr-cell-sub">{client.phone}</div>
                        </td>
                        <td>
                          {last ? (
                            <>
                              <span>{formatBrDate(last.day)} · {last.services}</span>
                              <div className="kr-cell-sub">
                                Último profissional: {last.professionalName} ({last.count}x)
                              </div>
                            </>
                          ) : (
                            <span className="kr-cell-sub">Sem atendimentos concluídos</span>
                          )}
                        </td>
                        <td>
                          <div className="kr-tags">
                            {client.user_id && <span className="kr-tag neutral">Conta ativa</span>}
                            {mem && (
                              <span className="kr-tag emerald">
                                Mensalista{memProf ? ` · ${memProf}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          {digits && (
                            <a
                              className="btn small"
                              href={`https://wa.me/${digits}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MessageCircle size={14} /> WhatsApp
                            </a>
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
      )}

      {view === 'pending' && canSeeFinance && (
        <div className="card kr-list-card">
          {filteredPending.length === 0 ? (
            <p className="empty-state">Nenhum atendimento concluído aguardando confirmação de pagamento.</p>
          ) : (
            <div className="kr-table-wrap">
              <table className="kr-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Data / Serviço</th>
                    <th>Profissional</th>
                    <th className="num">Valor pendente</th>
                    <th className="num">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPending.map(row => (
                    <tr key={row.charge.id}>
                      <td>
                        <strong>{row.client.name}</strong>
                        <div className="kr-cell-sub">{row.client.phone}</div>
                      </td>
                      <td>
                        <span>{formatBrDate(row.date)}</span>
                        <div className="kr-cell-sub">{row.serviceName}</div>
                      </td>
                      <td>{row.professionalName}</td>
                      <td className="num mono">
                        <strong>{money(row.remaining)}</strong>
                        <div className="kr-cell-sub">Pendente</div>
                      </td>
                      <td className="num">
                        {canPay && (
                          <button
                            type="button"
                            className="btn primary small"
                            onClick={() => onReceiveCharge(row.charge)}
                          >
                            Confirmar pagamento
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'overdue' && canSeeFinance && (
        <div className="card kr-list-card">
          {filteredOverdue.length === 0 ? (
            <p className="empty-state">Nenhum cliente com pagamento atrasado.</p>
          ) : (
            <div className="kr-table-wrap">
              <table className="kr-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Vencimento / Atraso</th>
                    <th>Descrição / Profissional</th>
                    <th className="num">Valor devido</th>
                    <th className="num">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverdue.map(row => (
                    <tr key={row.charge.id}>
                      <td>
                        <strong>{row.client.name}</strong>
                        <div className="kr-cell-sub">{row.client.phone}</div>
                      </td>
                      <td>
                        <span>{formatBrDate(row.dueDate)}</span>
                        <div className="kr-cell-sub danger-text">
                          {row.daysLate} {row.daysLate === 1 ? 'dia' : 'dias'} em atraso
                        </div>
                      </td>
                      <td>
                        <span>{row.charge.description}</span>
                        <div className="kr-cell-sub">{row.professionalName}</div>
                      </td>
                      <td className="num mono danger-text">
                        <strong>{money(row.remaining)}</strong>
                      </td>
                      <td className="num">
                        {canPay && (
                          <button
                            type="button"
                            className="btn primary small"
                            onClick={() => onReceiveCharge(row.charge)}
                          >
                            Registrar pagamento
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'inactive30' && (
        <div className="card kr-list-card">
          {filteredInactive.length === 0 ? (
            <p className="empty-state">Nenhum cliente sem atendimento há mais de 30 dias.</p>
          ) : (
            <div className="kr-table-wrap">
              <table className="kr-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Último atendimento</th>
                    <th>Último serviço / Profissional</th>
                    <th className="num">Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInactive.map(row => {
                    const digits = (row.client.phone || '').replace(/\D/g, '');
                    const msg = encodeURIComponent(
                      `Olá ${row.client.name.split(' ')[0]}! Já faz ${row.daysAway} dias desde seu último atendimento por aqui. Quer agendar seu próximo horário?`
                    );
                    return (
                      <tr key={row.client.id}>
                        <td>
                          <strong>{row.client.name}</strong>
                          <div className="kr-cell-sub">{row.client.phone}</div>
                        </td>
                        <td>
                          <span>{formatBrDate(row.lastDay)}</span>
                          <div className="kr-cell-sub warn-text">
                            Há {row.daysAway} dias sem cortar
                          </div>
                        </td>
                        <td>
                          <span>{row.lastService}</span>
                          <div className="kr-cell-sub">
                            Histórico: {row.lastProfessional}
                          </div>
                        </td>
                        <td className="num">
                          {digits && (
                            <a
                              className="btn small"
                              href={`https://wa.me/${digits}?text=${msg}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MessageCircle size={14} /> Chamar no WhatsApp
                            </a>
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
      )}
    </section>
  );
}
