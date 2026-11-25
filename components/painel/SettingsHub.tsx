'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  MessageSquareQuote,
  Plus,
  Save,
  Scissors,
  UserCog,
  Users,
} from 'lucide-react';
import Subscription from '@/components/Subscription';
import ProfessionalSettings from '@/components/ProfessionalSettings';
import { money } from '@/lib/domain';
import {
  WEEKDAY_NAMES,
  type ApiCallFn,
  type IdentityInfo,
  type ProfessionalRow,
  type ServiceRow,
  type ShopConfig,
  type ShopRow,
} from './types';

type CategoryId =
  | 'barbershop'
  | 'booking'
  | 'services'
  | 'payments'
  | 'team'
  | 'account'
  | 'subscription';

type SettingsHubProps = {
  shop: ShopRow;
  cfg: ShopConfig;
  setCfg: (next: ShopConfig) => void;
  shopName: string;
  setShopName: (v: string) => void;
  services: ServiceRow[];
  professionals: ProfessionalRow[];
  identity: IdentityInfo;
  dirty: boolean;
  saving: boolean;
  onSaveSettings: () => Promise<boolean>;
  onLookupCep: (cep: string) => Promise<void>;
  onOpenNewService: () => void;
  onOpenEditService: (svc: ServiceRow) => void;
  onToggleService: (svc: ServiceRow) => Promise<void>;
  onGoToEmployees: () => void;
  showWhatsappShortcutAlert?: boolean;
  onOpenWhatsappTutorial?: () => void;
  onMarkWhatsappShortcutDone?: () => void;
  call: ApiCallFn;
};

export function SettingsHub({
  shop,
  cfg,
  setCfg,
  shopName,
  setShopName,
  services,
  professionals,
  identity,
  dirty,
  saving,
  onSaveSettings,
  onLookupCep,
  onOpenNewService,
  onOpenEditService,
  onToggleService,
  onGoToEmployees,
  showWhatsappShortcutAlert,
  onOpenWhatsappTutorial,
  onMarkWhatsappShortcutDone,
}: SettingsHubProps) {
  const isOwner = identity.role === 'owner';
  const isManager = identity.role === 'owner' || identity.role === 'partner';

  const categories = useMemo(
    () =>
      (
        [
          {
            id: 'barbershop' as const,
            label: 'Minha barbearia',
            desc: 'Nome, localização, WhatsApp e identidade pública',
            icon: Building2,
            visible: isManager,
          },
          {
            id: 'booking' as const,
            label: 'Agendamentos',
            desc: 'Expediente geral, antecedência, grade e cancelamento',
            icon: CalendarClock,
            visible: isManager,
          },
          {
            id: 'services' as const,
            label: 'Serviços',
            desc: 'Catálogo, duração, valores e disponibilidade',
            icon: Scissors,
            visible: isManager,
          },
          {
            id: 'payments' as const,
            label: 'Pagamentos',
            desc: 'Pix, dinheiro, crédito, débito e taxas da maquininha',
            icon: CreditCard,
            visible: isManager,
          },
          {
            id: 'team' as const,
            label: 'Equipe e permissões',
            desc: 'Papéis, comissões e regras operacionais da equipe',
            icon: Users,
            visible: isManager,
          },
          {
            id: 'account' as const,
            label: 'Minha conta',
            desc: 'Expediente individual, pausas, feriados e preferências',
            icon: UserCog,
            visible: true,
          },
          {
            id: 'subscription' as const,
            label: 'Assinatura',
            desc: 'Plano Kronner, cadeiras adicionais e faturas',
            icon: Crown,
            visible: isOwner,
          },
        ] as const
      ).filter(c => c.visible),
    [isManager, isOwner]
  );

  const [activeCat, setActiveCat] = useState<CategoryId>(
    isManager ? 'barbershop' : 'account'
  );
  const [savedToast, setSavedToast] = useState(false);
  const [bufferEnabled, setBufferEnabled] = useState((cfg.buffer ?? 10) > 0);
  const [overtimeEnabled, setOvertimeEnabled] = useState((cfg.overtimeMinutes ?? 0) > 0);

  const overtimePreviewLimit = useMemo(() => {
    const mins = Math.max(0, Math.min(180, Number(cfg.overtimeMinutes || 0)));
    const total = 19 * 60 + mins;
    const h = String(Math.floor(total / 60)).padStart(2, '0');
    const m = String(total % 60).padStart(2, '0');
    return `${h}:${m}`;
  }, [cfg.overtimeMinutes]);

  async function saveWithFeedback() {
    const ok = await onSaveSettings();
    if (ok) {
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 3000);
    }
  }

  // Live preview: sample booking slots from Monday (or first enabled day)
  const sampleSlots = useMemo(() => {
    const day = cfg.week.find(w => w.enabled);
    if (!day) return [];
    const [oh, om] = (day.open || '09:00').split(':').map(Number);
    const step = Math.max(5, cfg.grid || 15);
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      const total = oh * 60 + om + i * step;
      const h = String(Math.floor(total / 60)).padStart(2, '0');
      const m = String(total % 60).padStart(2, '0');
      out.push(`${h}:${m}`);
    }
    return out;
  }, [cfg.week, cfg.grid]);

  // Live preview: R$ 100 fee simulation
  const creditNetPreview = 10000 - Math.round((10000 * (cfg.creditFee || 0)) / 10000);
  const debitNetPreview = 10000 - Math.round((10000 * (cfg.debitFee || 0)) / 10000);

  return (
    <section className="kr-module">
      <div className="kr-module-head">
        <div>
          <h2>Configurações</h2>
          <p className="kr-sub">
            Organize sua barbearia por categoria com pré-visualização imediata.
          </p>
        </div>

        {isManager && ['barbershop', 'booking', 'payments'].includes(activeCat) && (
          <div className="kr-actions-row">
            {dirty && <span className="kr-dirty-pill">Alterações não salvas</span>}
            {savedToast && (
              <span className="kr-saved-pill">
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={saveWithFeedback}
            >
              <Save size={15} /> {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        )}
      </div>

      {showWhatsappShortcutAlert && onOpenWhatsappTutorial && onMarkWhatsappShortcutDone && (
        <div className="card kr-shortcut-banner" role="region" aria-label="Dica de atalho rápido no WhatsApp">
          <div className="kr-shortcut-banner-main">
            <span className="kr-shortcut-banner-icon" aria-hidden="true">
              <MessageSquareQuote size={19} />
            </span>
            <div>
              <strong>
                Atalho rápido no WhatsApp (<span className="mono">/agendamento</span> ou{' '}
                <span className="mono">@@agendar</span>)
              </strong>
              <p>
                Configure uma frase pronta no teclado ou no WhatsApp Business para enviar seu link
                de agendamento aos clientes em 2 segundos. Depois de concluir, clique em OK para
                ocultar este aviso.
              </p>
            </div>
          </div>
          <div className="kr-shortcut-banner-actions">
            <button type="button" className="btn primary small" onClick={onOpenWhatsappTutorial}>
              Abrir tutorial
            </button>
            <button type="button" className="btn small" onClick={onMarkWhatsappShortcutDone}>
              <CheckCircle2 size={14} /> OK, já configurei
            </button>
          </div>
        </div>
      )}

      <div className="kr-settings-layout">
        <nav className="kr-settings-nav" aria-label="Categorias de configurações">
          {categories.map(cat => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                type="button"
                className={`kr-settings-cat ${activeCat === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCat(cat.id)}
              >
                <span className="kr-settings-cat-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{cat.label}</strong>
                  <small>{cat.desc}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="kr-settings-body">
          {activeCat === 'barbershop' && isManager && (
            <div className="kr-settings-stack">
              <div className="card kr-form-card">
                <h3>Identidade e dados públicos</h3>
                <div className="kr-form-grid">
                  <label>
                    Nome da barbearia
                    <input
                      type="text"
                      value={shopName}
                      onChange={e => setShopName(e.target.value)}
                    />
                  </label>
                  <label>
                    Nome do titular na página pública
                    <input
                      type="text"
                      value={cfg.professional || ''}
                      onChange={e => setCfg({ ...cfg, professional: e.target.value })}
                    />
                  </label>
                  <label>
                    WhatsApp da barbearia (com DDD)
                    <input
                      type="tel"
                      value={cfg.phone || ''}
                      onChange={e => setCfg({ ...cfg, phone: e.target.value })}
                      placeholder="+5511999999999"
                    />
                  </label>
                  <label>
                    CEP (busca automática)
                    <input
                      type="text"
                      value={cfg.cep || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setCfg({ ...cfg, cep: val });
                        if (val.replace(/\D/g, '').length === 8) onLookupCep(val);
                      }}
                      placeholder="00000-000"
                    />
                  </label>
                  <label>
                    Endereço público
                    <input
                      type="text"
                      value={cfg.address || ''}
                      onChange={e => setCfg({ ...cfg, address: e.target.value })}
                    />
                  </label>
                  <label>
                    Cidade
                    <input
                      type="text"
                      value={cfg.city || ''}
                      onChange={e => setCfg({ ...cfg, city: e.target.value })}
                    />
                  </label>
                  <label>
                    Estado (UF)
                    <input
                      type="text"
                      maxLength={2}
                      value={cfg.state || ''}
                      onChange={e => setCfg({ ...cfg, state: e.target.value.toUpperCase() })}
                    />
                  </label>
                  <label>
                    Fuso horário
                    <select
                      value={cfg.timezone}
                      onChange={e => setCfg({ ...cfg, timezone: e.target.value })}
                    >
                      <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
                      <option value="America/Manaus">Manaus (GMT-4)</option>
                      <option value="America/Rio_Branco">Acre (GMT-5)</option>
                      <option value="America/Noronha">Fernando de Noronha (GMT-2)</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="card kr-preview-card">
                <div className="kr-preview-head">
                  <span>Prévia da página pública de agendamento</span>
                  <a href={`/b/${shop.slug}`} target="_blank" rel="noreferrer" className="btn small">
                    <ExternalLink size={13} /> Abrir página
                  </a>
                </div>
                <div className="kr-public-preview">
                  <strong>{shopName || 'Sua Barbearia'}</strong>
                  <p>
                    {[cfg.address, cfg.city, cfg.state].filter(Boolean).join(' · ') ||
                      'Endereço e cidade aparecerão aqui'}
                  </p>
                  <small className="mono">/b/{shop.slug}</small>
                </div>
              </div>
            </div>
          )}

          {activeCat === 'booking' && isManager && (
            <div className="kr-settings-stack">
              <div className="card kr-form-card">
                <h3>Regras da página pública de agendamento</h3>
                <div className="kr-form-grid">
                  <label>
                    Janela de agenda (dias à frente)
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={cfg.maxDays}
                      onChange={e => setCfg({ ...cfg, maxDays: Number(e.target.value) || 21 })}
                    />
                  </label>
                  <label>
                    Grade de horários (minutos)
                    <input
                      type="number"
                      min={5}
                      max={60}
                      step={5}
                      value={cfg.grid}
                      onChange={e => setCfg({ ...cfg, grid: Number(e.target.value) || 15 })}
                    />
                  </label>
                  <label>
                    Antecedência mínima (minutos)
                    <input
                      type="number"
                      min={0}
                      value={cfg.notice}
                      onChange={e => setCfg({ ...cfg, notice: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    Prazo para cancelamento (minutos)
                    <input
                      type="number"
                      min={0}
                      value={cfg.cancelMinutes}
                      onChange={e => setCfg({ ...cfg, cancelMinutes: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>

                <div className="kr-buffer-box">
                  <label className="kr-check-inline">
                    <input
                      type="checkbox"
                      checked={bufferEnabled}
                      onChange={e => {
                        const checked = e.target.checked;
                        setBufferEnabled(checked);
                        setCfg({
                          ...cfg,
                          buffer: checked ? (cfg.buffer && cfg.buffer > 0 ? cfg.buffer : 10) : 0,
                        });
                      }}
                    />
                    <strong>Intervalo de segurança entre atendimentos</strong>
                  </label>
                  <p className="kr-buffer-help">
                    Reserva automaticamente minutos extras após cada atendimento na agenda caso o
                    corte passe do tempo. Se terminar antes, você pode excluir esse intervalo direto
                    na agenda para liberar o horário.
                  </p>
                  {bufferEnabled && (
                    <label className="kr-buffer-input-label">
                      Duração do intervalo de segurança (minutos)
                      <input
                        type="number"
                        min={1}
                        max={180}
                        step={5}
                        value={cfg.buffer || ''}
                        onChange={e =>
                          setCfg({
                            ...cfg,
                            buffer: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                          })
                        }
                      />
                    </label>
                  )}
                </div>

                <div className="kr-buffer-box">
                  <label className="kr-check-inline">
                    <input
                      type="checkbox"
                      checked={overtimeEnabled}
                      onChange={e => {
                        const checked = e.target.checked;
                        setOvertimeEnabled(checked);
                        setCfg({
                          ...cfg,
                          overtimeMinutes: checked
                            ? cfg.overtimeMinutes && cfg.overtimeMinutes > 0
                              ? cfg.overtimeMinutes
                              : 30
                            : 0,
                        });
                      }}
                    />
                    <strong>Permitir último atendimento ultrapassar o encerramento</strong>
                  </label>
                  <p className="kr-buffer-help">
                    Por padrão, o sistema respeita 100% o horário de fechamento (se você encerra às
                    19:00, um corte de 50 min não aparece às 18:20 porque terminaria às 19:10).
                    Ative esta opção se quiser liberar aquele último cliente próximo do fechamento,
                    mesmo que o término passe um pouco do expediente.
                  </p>
                  {overtimeEnabled && (
                    <>
                      <label className="kr-buffer-input-label">
                        Tolerância máxima após o encerramento (minutos)
                        <input
                          type="number"
                          min={5}
                          max={180}
                          step={5}
                          value={cfg.overtimeMinutes || ''}
                          onChange={e =>
                            setCfg({
                              ...cfg,
                              overtimeMinutes: Math.max(
                                0,
                                Math.min(180, Number(e.target.value) || 0)
                              ),
                            })
                          }
                        />
                      </label>
                      <small className="kr-buffer-example">
                        Exemplo: fechando às 19:00 com {cfg.overtimeMinutes || 0} min de tolerância,
                        o cliente ainda pode iniciar antes das 19:00 desde que o serviço termine até{' '}
                        <strong>{overtimePreviewLimit}</strong>.
                      </small>
                    </>
                  )}
                </div>
              </div>

              <div className="card kr-form-card">
                <h3>Expediente geral da barbearia</h3>
                <div className="kr-week-grid">
                  {cfg.week.map((day, idx) => (
                    <div key={idx} className={`kr-week-row ${day.enabled ? '' : 'off'}`}>
                      <label className="kr-check-inline">
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          onChange={e => {
                            const next = cfg.week.map((w, i) =>
                              i === idx ? { ...w, enabled: e.target.checked } : w
                            );
                            setCfg({ ...cfg, week: next });
                          }}
                        />
                        <strong>{WEEKDAY_NAMES[idx]}</strong>
                      </label>
                      {day.enabled && (
                        <div className="kr-week-times">
                          <input
                            type="time"
                            value={day.open}
                            aria-label={`Abertura ${WEEKDAY_NAMES[idx]}`}
                            onChange={e => {
                              const next = cfg.week.map((w, i) =>
                                i === idx ? { ...w, open: e.target.value } : w
                              );
                              setCfg({ ...cfg, week: next });
                            }}
                          />
                          <span>às</span>
                          <input
                            type="time"
                            value={day.close}
                            aria-label={`Fechamento ${WEEKDAY_NAMES[idx]}`}
                            onChange={e => {
                              const next = cfg.week.map((w, i) =>
                                i === idx ? { ...w, close: e.target.value } : w
                              );
                              setCfg({ ...cfg, week: next });
                            }}
                          />
                          <span className="kr-pause-label">Pausa:</span>
                          <input
                            type="time"
                            value={day.lunchStart || ''}
                            aria-label={`Início pausa ${WEEKDAY_NAMES[idx]}`}
                            onChange={e => {
                              const next = cfg.week.map((w, i) =>
                                i === idx ? { ...w, lunchStart: e.target.value } : w
                              );
                              setCfg({ ...cfg, week: next });
                            }}
                          />
                          <input
                            type="time"
                            value={day.lunchEnd || ''}
                            aria-label={`Fim pausa ${WEEKDAY_NAMES[idx]}`}
                            onChange={e => {
                              const next = cfg.week.map((w, i) =>
                                i === idx ? { ...w, lunchEnd: e.target.value } : w
                              );
                              setCfg({ ...cfg, week: next });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card kr-preview-card">
                <div className="kr-preview-head">
                  <span>Prévia dos horários gerados (grade de {cfg.grid} min)</span>
                </div>
                <div className="kr-slot-preview">
                  {sampleSlots.map(s => (
                    <span key={s} className="kr-slot-chip mono">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeCat === 'services' && isManager && (
            <div className="card kr-list-card">
              <div className="kr-card-head">
                <h3>Catálogo de serviços</h3>
                <button type="button" className="btn primary small" onClick={onOpenNewService}>
                  <Plus size={14} /> Novo serviço
                </button>
              </div>
              {services.length === 0 ? (
                <p className="empty-state">Cadastre seu primeiro serviço para liberar agendamentos.</p>
              ) : (
                <div className="kr-service-list">
                  {services.map(svc => (
                    <article key={svc.id} className="kr-service-row">
                      <div>
                        <strong>{svc.name}</strong>
                        <div className="kr-cell-sub mono">
                          {money(svc.price)} · {svc.duration} min ·{' '}
                          {svc.active ? 'Visível na agenda' : 'Oculto'}
                        </div>
                      </div>
                      <div className="kr-actions-row">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => onOpenEditService(svc)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => onToggleService(svc)}
                        >
                          {svc.active ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeCat === 'payments' && isManager && (
            <div className="kr-settings-stack">
              <div className="card kr-form-card">
                <h3>Formas de pagamento e taxas da maquininha</h3>
                <p className="kr-sub">
                  Pix e dinheiro têm taxa zero. Informe as taxas médias de crédito e débito para
                  calcular automaticamente seu valor líquido.
                </p>
                <div className="kr-form-grid">
                  <label>
                    Taxa de Crédito (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={(cfg.creditFee / 100).toString()}
                      onChange={e =>
                        setCfg({
                          ...cfg,
                          creditFee: Math.round((Number(e.target.value) || 0) * 100),
                        })
                      }
                    />
                  </label>
                  <label>
                    Taxa de Débito (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={(cfg.debitFee / 100).toString()}
                      onChange={e =>
                        setCfg({
                          ...cfg,
                          debitFee: Math.round((Number(e.target.value) || 0) * 100),
                        })
                      }
                    />
                  </label>
                  <label>
                    Carência antes de marcar atraso (dias)
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={cfg.grace}
                      onChange={e => setCfg({ ...cfg, grace: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
              </div>

              <div className="card kr-preview-card">
                <div className="kr-preview-head">
                  <span>Simulação em um atendimento de R$ 100,00</span>
                </div>
                <div className="kr-method-grid">
                  <div className="kr-method-item">
                    <span>Pix / Dinheiro</span>
                    <strong className="mono emerald-text">R$ 100,00</strong>
                    <small>Taxa 0%</small>
                  </div>
                  <div className="kr-method-item">
                    <span>Crédito</span>
                    <strong className="mono">{money(creditNetPreview)}</strong>
                    <small>Taxa {(cfg.creditFee / 100).toFixed(2)}%</small>
                  </div>
                  <div className="kr-method-item">
                    <span>Débito</span>
                    <strong className="mono">{money(debitNetPreview)}</strong>
                    <small>Taxa {(cfg.debitFee / 100).toFixed(2)}%</small>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeCat === 'team' && isManager && (
            <div className="card kr-form-card">
              <h3>Resumo da equipe e permissões</h3>
              <p className="kr-sub">
                Atualmente você possui <strong>{professionals.length}</strong>{' '}
                {professionals.length === 1 ? 'profissional ativo' : 'profissionais ativos'}.
                Gerencie convites, papéis, comissões individuais e folgas/férias no painel dedicado
                de Funcionários.
              </p>
              <div className="kr-actions-row">
                <button type="button" className="btn primary" onClick={onGoToEmployees}>
                  <Users size={15} /> Abrir gestão de funcionários
                </button>
              </div>
            </div>
          )}

          {activeCat === 'account' && (
            <div className="kr-settings-stack">
              <ProfessionalSettings />
            </div>
          )}

          {activeCat === 'subscription' && isOwner && (
            <div className="kr-settings-stack">
              <Subscription />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
