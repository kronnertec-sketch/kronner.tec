'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  CalendarOff,
  CheckCircle2,
  Copy,
  Percent,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  ROLE_LABELS,
  type ApiCallFn,
  type IdentityInfo,
  type ProfessionalRow,
  type UserRole,
} from './types';

type EmployeesPanelProps = {
  identity: IdentityInfo;
  call: ApiCallFn;
  onTeamChanged: () => Promise<void>;
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  invited: 'Convite pendente',
  inactive: 'Desativado',
};

export function EmployeesPanel({ identity, call, onTeamChanged }: EmployeesPanelProps) {
  const { getToken } = useAuth();
  const isManager = identity.role === 'owner' || identity.role === 'partner';

  const [members, setMembers] = useState<ProfessionalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  // Invite form state (progressive)
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<'employee' | 'partner'>('employee');
  const [invCommissionEnabled, setInvCommissionEnabled] = useState(false);
  const [invCommissionPct, setInvCommissionPct] = useState('40');
  const [invFinance, setInvFinance] = useState(false);
  const [invMemberships, setInvMemberships] = useState(false);
  const [invRegisterPay, setInvRegisterPay] = useState(true);
  const [invShareLink, setInvShareLink] = useState(true);

  // Vacation form state (owner/partner)
  const [vacProf, setVacProf] = useState(identity.id);
  const [vacStart, setVacStart] = useState('');
  const [vacEnd, setVacEnd] = useState('');
  const [vacReason, setVacReason] = useState('Folga / Férias');

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await call('team:list')) as ProfessionalRow[];
      setMembers(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar equipe.');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setInviteLink('');
    try {
      const token = await getToken({ template: 'kroner_claims' }).catch(() => getToken());
      if (!token) throw new Error('Sessão expirada. Recarregue a página e tente novamente.');
      const pct = Math.max(0, Math.min(100, Number(invCommissionPct.replace(',', '.')) || 0));
      const response = await fetch('/api/equipe/convite', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: invName.trim(),
          email: invEmail.trim(),
          role: invRole,
          finance: invRole === 'partner' ? true : invFinance,
          commission_enabled: invCommissionEnabled,
          commission_bps: invCommissionEnabled ? Math.round(pct * 100) : 0,
          can_manage_memberships: invRole === 'partner' ? true : invMemberships,
          can_register_payment: invRole === 'partner' ? true : invRegisterPay,
          can_share_link: invRole === 'partner' ? true : invShareLink,
        }),
      });
      const res = await response.json();
      if (!response.ok) throw new Error(res.error || 'Falha ao gerar convite.');
      if (res.token) setInviteLink(location.origin + '/equipe#' + res.token);
      setNotice(
        res.sent
          ? 'Convite enviado por e-mail! Você também pode compartilhar o link abaixo.'
          : 'Convite criado! Compartilhe o link abaixo com o profissional.'
      );
      setInvName('');
      setInvEmail('');
      setInvCommissionEnabled(false);
      await loadMembers();
      await onTeamChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao convidar.');
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(m: ProfessionalRow, patch: Partial<ProfessionalRow>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const nextRole = (patch.role || m.role || 'employee') as 'partner' | 'employee';
      const nextCommEnabled =
        patch.commission_enabled !== undefined ? patch.commission_enabled : !!m.commission_enabled;
      const nextCommBps =
        patch.commission_bps !== undefined ? patch.commission_bps : m.commission_bps || 0;
      await call('team:permissions', {
        id: m.id,
        role: nextRole,
        finance: patch.finance !== undefined ? patch.finance : !!m.finance,
        commission_enabled: nextCommEnabled,
        commission_bps: nextCommBps,
        can_manage_memberships:
          patch.can_manage_memberships !== undefined
            ? patch.can_manage_memberships
            : !!m.can_manage_memberships,
        can_register_payment:
          patch.can_register_payment !== undefined
            ? patch.can_register_payment
            : m.can_register_payment !== false,
        can_share_link:
          patch.can_share_link !== undefined ? patch.can_share_link : m.can_share_link !== false,
      });
      setNotice(`Permissões de ${m.name} atualizadas. Históricos antigos permanecem preservados.`);
      await loadMembers();
      await onTeamChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar profissional.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivateMember(m: ProfessionalRow) {
    if (
      !confirm(
        `Desativar o acesso de ${m.name}? Todo o histórico de atendimentos e comissões será preservado.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call('team:deactivate', { id: m.id });
      setNotice(`${m.name} foi desativado com histórico preservado.`);
      await loadMembers();
      await onTeamChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível desativar.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddVacation(e: React.FormEvent) {
    e.preventDefault();
    if (!vacStart) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call('team:add_vacation', {
        professional: vacProf,
        start: vacStart,
        end: vacEnd || vacStart,
        reason: vacReason,
      });
      setVacStart('');
      setVacEnd('');
      setNotice('Folga/férias registrada e agenda protegida.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar folga/férias.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveVacation(profId: string, vacId: string) {
    setBusy(true);
    setError('');
    try {
      await call('team:remove_vacation', { professional: profId, id: vacId });
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover folga.');
    } finally {
      setBusy(false);
    }
  }

  const activeMembers = members.filter(m => m.status === 'active');
  const visibleMembers = members.filter(m => m.status !== 'inactive');

  return (
    <section className="kr-module">
      <div className="kr-module-head">
        <div>
          <h2>Funcionários e permissões</h2>
          <p className="kr-sub">
            {isManager
              ? 'Adicione profissionais, configure comissões individuais, permissões e folgas/férias.'
              : 'Profissionais ativos da barbearia.'}
          </p>
        </div>
        <span className="kr-tag neutral">
          <Users size={14} /> {activeMembers.length}{' '}
          {activeMembers.length === 1 ? 'profissional ativo' : 'profissionais ativos'}
        </span>
      </div>

      {error && <p role="alert" className="notice danger">{error}</p>}
      {notice && (
        <p role="status" className="notice success-notice">
          <CheckCircle2 size={15} /> {notice}
        </p>
      )}

      {isManager && (
        <form className="card kr-form-card" onSubmit={handleInvite}>
          <div className="kr-card-head">
            <h3><UserPlus size={17} /> Convidar novo profissional</h3>
          </div>
          <p className="kr-pricing-note">
            Cada cadeira adicional (funcionário ou sócio) acrescenta{' '}
            <strong>R$ 35,90/mês</strong> ao plano base (R$ 99,90/mês) quando os 15 dias grátis
            terminarem e a assinatura for ativada.
          </p>

          <div className="kr-form-grid">
            <label>
              Nome completo
              <input
                type="text"
                required
                minLength={2}
                maxLength={100}
                placeholder="Ex.: Vitor Silva"
                value={invName}
                onChange={e => setInvName(e.target.value)}
              />
            </label>
            <label>
              E-mail do profissional
              <input
                type="email"
                required
                placeholder="vitor@email.com"
                value={invEmail}
                onChange={e => setInvEmail(e.target.value)}
              />
            </label>
            <label>
              Papel na barbearia
              <select
                value={invRole}
                onChange={e => setInvRole(e.target.value as 'employee' | 'partner')}
              >
                <option value="employee">Colaborador (operacional)</option>
                <option value="partner">Sócio (gestão completa, exceto assinatura)</option>
              </select>
            </label>
          </div>

          <div className="kr-progressive-box">
            <label className="kr-switch-row">
              <input
                type="checkbox"
                checked={invCommissionEnabled}
                onChange={e => setInvCommissionEnabled(e.target.checked)}
              />
              <span>
                <strong>Ativar comissão individual</strong>
                <small>Sem comissão obrigatória — o percentual fica gravado em cada atendimento.</small>
              </span>
            </label>

            {invCommissionEnabled && (
              <div className="kr-nested-field">
                <label>
                  Percentual de comissão (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={invCommissionPct}
                    onChange={e => setInvCommissionPct(e.target.value)}
                  />
                </label>
              </div>
            )}

            {invRole === 'employee' && (
              <div className="kr-perm-grid">
                <label className="kr-switch-row">
                  <input
                    type="checkbox"
                    checked={invFinance}
                    onChange={e => setInvFinance(e.target.checked)}
                  />
                  <span>
                    <strong>Acesso ao próprio financeiro</strong>
                    <small>Visualizar recebimentos dos próprios atendimentos.</small>
                  </span>
                </label>
                <label className="kr-switch-row">
                  <input
                    type="checkbox"
                    checked={invRegisterPay}
                    onChange={e => setInvRegisterPay(e.target.checked)}
                  />
                  <span>
                    <strong>Registrar pagamentos</strong>
                    <small>Confirmar recebimento ao finalizar seus atendimentos.</small>
                  </span>
                </label>
                <label className="kr-switch-row">
                  <input
                    type="checkbox"
                    checked={invMemberships}
                    onChange={e => setInvMemberships(e.target.checked)}
                  />
                  <span>
                    <strong>Acesso aos seus mensalistas</strong>
                    <small>Gerenciar apenas os planos mensalistas sob sua responsabilidade.</small>
                  </span>
                </label>
                <label className="kr-switch-row">
                  <input
                    type="checkbox"
                    checked={invShareLink}
                    onChange={e => setInvShareLink(e.target.checked)}
                  />
                  <span>
                    <strong>Divulgar próprio link</strong>
                    <small>Compartilhar o link direto da própria cadeira.</small>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="kr-actions-row">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Gerando convite...' : 'Gerar e enviar convite'}
            </button>
          </div>

          {inviteLink && (
            <div className="kr-invite-link-box">
              <input readOnly value={inviteLink} onFocus={e => e.target.select()} />
              <button
                type="button"
                className="btn small"
                onClick={() => navigator.clipboard.writeText(inviteLink)}
              >
                <Copy size={14} /> Copiar link
              </button>
            </div>
          )}
        </form>
      )}

      <div className="card kr-list-card">
        <h3><Shield size={17} /> Equipe cadastrada</h3>
        {loading ? (
          <p className="empty-state">Carregando equipe...</p>
        ) : visibleMembers.length === 0 ? (
          <p className="empty-state">Nenhum profissional cadastrado.</p>
        ) : (
          <div className="kr-member-stack">
            {visibleMembers.map(m => {
              const role = (m.role || 'employee') as UserRole;
              const isOwnerRow = role === 'owner';
              return (
                <article key={m.id} className="kr-member-card">
                  <div className="kr-member-top">
                    <div>
                      <strong>{m.name}</strong>
                      <div className="kr-tags">
                        <span className={`kr-tag ${isOwnerRow ? 'emerald' : 'neutral'}`}>
                          {ROLE_LABELS[role]}
                        </span>
                        <span className={`kr-tag ${m.status === 'active' ? 'emerald' : 'warn'}`}>
                          {STATUS_LABELS[m.status || 'active']}
                        </span>
                        {(isManager || m.id === identity.id) && m.commission_enabled && (
                          <span className="kr-tag brass">
                            <Percent size={12} /> {((m.commission_bps || 0) / 100).toFixed(0)}% comissão
                          </span>
                        )}
                      </div>
                    </div>

                    {isManager && !isOwnerRow && m.id !== identity.id && (identity.role === 'owner' || role !== 'partner') && (
                      <div className="kr-actions-row">
                        <select
                          aria-label={`Papel de ${m.name}`}
                          disabled={busy}
                          value={role}
                          onChange={e => updateMember(m, { role: e.target.value as UserRole })}
                        >
                          <option value="employee">Colaborador</option>
                          <option value="partner">Sócio</option>
                        </select>
                        <button
                          type="button"
                          className="btn danger small"
                          disabled={busy}
                          onClick={() => deactivateMember(m)}
                        >
                          Desativar
                        </button>
                      </div>
                    )}
                  </div>

                  {isManager && !isOwnerRow && m.id !== identity.id && (identity.role === 'owner' || role !== 'partner') && (
                    <div className="kr-member-controls">
                      <div className="kr-comm-row">
                        <label className="kr-check-inline">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={!!m.commission_enabled}
                            onChange={e =>
                              updateMember(m, {
                                commission_enabled: e.target.checked,
                                commission_bps:
                                  e.target.checked && !m.commission_bps ? 4000 : m.commission_bps,
                              })
                            }
                          />
                          <span>Comissão ativa</span>
                        </label>
                        {m.commission_enabled && (
                          <label className="kr-pct-inline">
                            <span>%</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.5"
                              defaultValue={((m.commission_bps || 0) / 100).toString()}
                              onBlur={e => {
                                const val = Math.max(
                                  0,
                                  Math.min(100, Number(e.target.value.replace(',', '.')) || 0)
                                );
                                const bps = Math.round(val * 100);
                                if (bps !== (m.commission_bps || 0)) {
                                  updateMember(m, { commission_bps: bps });
                                }
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {role === 'employee' && (
                        <div className="kr-perm-pills">
                          <label className="kr-check-inline">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!!m.finance}
                              onChange={e => updateMember(m, { finance: e.target.checked })}
                            />
                            <span>Financeiro próprio</span>
                          </label>
                          <label className="kr-check-inline">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={m.can_register_payment !== false}
                              onChange={e =>
                                updateMember(m, { can_register_payment: e.target.checked })
                              }
                            />
                            <span>Registrar pagamentos</span>
                          </label>
                          <label className="kr-check-inline">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!!m.can_manage_memberships}
                              onChange={e =>
                                updateMember(m, { can_manage_memberships: e.target.checked })
                              }
                            />
                            <span>Seus mensalistas</span>
                          </label>
                          <label className="kr-check-inline">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={m.can_share_link !== false}
                              onChange={e => updateMember(m, { can_share_link: e.target.checked })}
                            />
                            <span>Divulgar link</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {isManager && (
        <div className="card kr-form-card">
          <h3><CalendarOff size={17} /> Folgas e férias com proteção de agenda</h3>
          <p className="kr-sub">
            O sistema verifica automaticamente se há agendamentos confirmados no período antes de
            liberar a folga ou férias.
          </p>

          <form className="kr-form-row" onSubmit={handleAddVacation}>
            {activeMembers.length > 1 && (
              <label>
                Profissional
                <select value={vacProf} onChange={e => setVacProf(e.target.value)}>
                  {activeMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Início
              <input
                type="date"
                required
                value={vacStart}
                onChange={e => setVacStart(e.target.value)}
              />
            </label>
            <label>
              Fim
              <input
                type="date"
                value={vacEnd}
                min={vacStart}
                onChange={e => setVacEnd(e.target.value)}
              />
            </label>
            <label>
              Motivo
              <input
                type="text"
                value={vacReason}
                maxLength={120}
                onChange={e => setVacReason(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              Confirmar folga/férias
            </button>
          </form>

          <div className="kr-vac-list">
            {activeMembers.flatMap(m =>
              (m.vacations || []).map(v => (
                <div key={`${m.id}-${v.id}`} className="kr-vac-item">
                  <span>
                    <strong>{m.name}</strong> · {v.start} até {v.end} — {v.reason}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy}
                    onClick={() => handleRemoveVacation(m.id, v.id)}
                  >
                    <Trash2 size={13} /> Remover
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
