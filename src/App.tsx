import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  RotateCcw,
  UserCheck,
  Zap,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ExternalLink,
  ChevronRight,
  Info,
  RefreshCw,
  Sliders,
  DollarSign,
  Activity,
  Layers,
  ArrowRight,
  Check,
  X,
  FileText,
  User,
} from 'lucide-react';

interface MetricsData {
  totalPayments: number;
  totalFailedPayments: number;
  totalRecoveredPayments: number;
  atRiskRevenueINR: number;
  simulatedRecoveredRevenueINR: number;
  recoveryRatePercent: number;
  isSimulatedData: boolean;
  simulatedDisclosure?: string;
}

interface MetricsResponse {
  metrics: MetricsData;
  decisionsBreakdown: {
    ALLOW: number;
    HUMAN_APPROVAL_REQUIRED: number;
    DENY: number;
  };
  failureReasonCounts: Record<string, number>;
  paymentMethodCounts: Record<string, number>;
  stoppingReasonCounts: Record<string, number>;
}

interface PaymentItem {
  id: string;
  merchantId: string;
  customerId: string;
  gatewayPaymentId: string;
  amountINR: number;
  amountMinor: string;
  currency: string;
  paymentMethod: string;
  status: string;
  failureReason: string | null;
  transactionCreatedAt: string;
  recoveredAt: string | null;
}

interface DecisionDetail {
  id: string;
  policyRuleTriggered: string;
  policyDecision: string;
  action: string;
  recoveryScore: number | null;
  failureReasonScore: number | null;
  retryScore: number | null;
  recencyScore: number | null;
  historyScore: number | null;
  confidenceScore: number | null;
  aiResponse: {
    diagnosis: string;
    confidence: number;
    recommendedAction: string;
    reasoningFactors: string[];
  } | null;
  aiValid: boolean;
  createdAt: string;
}

interface EscalationItem {
  decisionId: string;
  paymentId: string;
  customerId: string;
  externalCustomerId: string;
  gatewayPaymentId: string;
  amountINR: number;
  amountMinor: string;
  currency: string;
  paymentMethod: string;
  failureReason: string;
  policyRuleTriggered: string;
  reasonCode: string;
  reason: string;
  aiDiagnosis: string | null;
  aiConfidence: number | null;
  aiReasoningFactors: string[];
  evaluationTime: string;
}

interface TimelineEvent {
  step: number;
  stage: 'INGESTION' | 'AI_DIAGNOSIS' | 'POLICY_EVALUATION' | 'HUMAN_REVIEW' | 'EXECUTION' | 'DISPOSITION';
  title: string;
  description: string;
  timestamp: string;
  badgeType: 'info' | 'success' | 'warning' | 'error';
  metadata: Record<string, unknown>;
}

interface PaymentAuditTimeline {
  paymentId: string;
  gatewayPaymentId: string;
  merchantId: string;
  customerId: string;
  amountINR: number;
  currency: string;
  paymentMethod: string;
  currentStatus: string;
  failureReason: string | null;
  recoveredAt: string | null;
  timeline: TimelineEvent[];
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string) ||
  (import.meta.env.VITE_API_URL as string) ||
  '';

export default function App() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Batch Recovery States
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [batchLimit, setBatchLimit] = useState(20);
  const [batchResultBanner, setBatchResultBanner] = useState<string | null>(null);

  // Active Tab & Search
  const [activeTab, setActiveTab] = useState<'all' | 'recovered' | 'review' | 'stopped'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Inspect Modal States
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<DecisionDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Operator Action State
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // AI Diagnostic Playground
  const [playgroundReason, setPlaygroundReason] = useState('NETWORK_ERROR');
  const [playgroundMethod, setPlaygroundMethod] = useState('upi');
  const [playgroundResult, setPlaygroundResult] = useState<any>(null);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const [metricsRes, paymentsRes, escalationsRes] = await Promise.all([
        fetch(`${API_BASE}/api/metrics`).then((r) => r.json()),
        fetch(`${API_BASE}/api/payments?limit=100`).then((r) => r.json()),
        fetch(`${API_BASE}/api/escalations`).then((r) => r.json()),
      ]);

      if (metricsRes.metrics) setMetrics(metricsRes);
      if (paymentsRes.payments) setPayments(paymentsRes.payments);
      if (escalationsRes.escalations) setEscalations(escalationsRes.escalations);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Run Batch Recovery
  const runBatchRecovery = async () => {
    try {
      setBatchLoading(true);
      setBatchResultBanner(null);
      const res = await fetch(`${API_BASE}/api/recovery/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: batchLimit,
          dryRun: batchDryRun,
        }),
      });
      const data = await res.json();
      if (data.success && data.batch) {
        const b = data.batch;
        setBatchResultBanner(
          `${b.dryRun ? '🔍 Dry-Run Simulated' : '⚡ Batch Processed'}: ${b.totalProcessed} payments evaluated (${b.breakdown.automatedRecoveries} recovered, ${b.breakdown.humanApprovalsQueued} in review, ${b.breakdown.stoppedOrDenied} stopped). Recovered ₹${b.totalRecoveredINR.toLocaleString('en-IN')}`,
        );
        await loadData();
      }
    } catch (err) {
      console.error('Batch recovery error:', err);
    } finally {
      setBatchLoading(false);
    }
  };

  // Inspect payment & fetch timeline
  const inspectPayment = async (p: PaymentItem) => {
    setSelectedPayment(p);
    setSelectedDecision(null);
    setTimeline([]);
    try {
      setInspectLoading(true);
      const [decRes, timeRes] = await Promise.all([
        fetch(`${API_BASE}/api/recovery-decisions/${p.id}`).then((r) => r.json()),
        fetch(`${API_BASE}/api/audit-trail/${p.id}`).then((r) => r.json()),
      ]);

      if (decRes.decisions && decRes.decisions.length > 0) {
        setSelectedDecision(decRes.decisions[0]);
      }
      if (timeRes.timeline) {
        setTimeline(timeRes.timeline);
      }
    } catch (err) {
      console.error('Failed to load audit inspection:', err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Operator Approves Escalation
  const handleApprove = async (decisionId: string) => {
    try {
      setActionLoadingId(decisionId);
      setActionFeedback(null);
      const res = await fetch(`${API_BASE}/api/escalations/${decisionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Approved by human operator via dashboard review' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`✅ Approved: ${data.message}`);
        await loadData();
      } else {
        setActionFeedback(`❌ Rejected by Guard: ${data.message}`);
      }
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Operator Rejects Escalation
  const handleReject = async (decisionId: string) => {
    try {
      setActionLoadingId(decisionId);
      setActionFeedback(null);
      const res = await fetch(`${API_BASE}/api/escalations/${decisionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Rejected by human operator: high risk profile' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`🛑 Stopped: ${data.message}`);
        await loadData();
      }
    } catch (err) {
      console.error('Rejection failed:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Run AI Playground Test
  const runPlaygroundTest = async () => {
    try {
      setPlaygroundLoading(true);
      const res = await fetch(`${API_BASE}/api/ai/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          failureReason: playgroundReason,
          paymentMethod: playgroundMethod,
        }),
      });
      const data = await res.json();
      setPlaygroundResult(data);
    } catch (err) {
      console.error('Playground error:', err);
    } finally {
      setPlaygroundLoading(false);
    }
  };

  // Filter payments
  const filteredPayments = payments.filter((p) => {
    if (activeTab === 'recovered' && p.status !== 'recovered') return false;
    if (activeTab === 'stopped' && p.status !== 'failed') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.id.toLowerCase().includes(q) ||
        p.gatewayPaymentId.toLowerCase().includes(q) ||
        p.customerId.toLowerCase().includes(q) ||
        (p.failureReason && p.failureReason.toLowerCase().includes(q)) ||
        p.paymentMethod.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Banner: Transparency & Simulated Disclosure */}
      <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Simulated Demo Environment:</strong> All ₹ figures represent simulated recovery over synthetic Razorpay payment events. AI recommends; deterministic policy disposes.
          </span>
        </div>
        <span className="bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider">
          Synthetic V1
        </span>
      </div>

      {/* Main Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/30 p-2 rounded-xl text-emerald-400">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">RecoverAI</h1>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-medium px-2 py-0.5 rounded-full">
                Live Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Autonomous Payment Revenue Recovery & Deterministic Policy Safety
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-mono text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {API_BASE.replace(/^https?:\/\//, '') || 'same-origin'}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Feedback Alert */}
        {actionFeedback && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs flex items-center justify-between">
            <span className="font-medium text-slate-200">{actionFeedback}</span>
            <button onClick={() => setActionFeedback(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
          </div>
        )}

        {/* KPI Cards Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Simulated Revenue Recovered */}
          <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-medium text-emerald-400 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" /> Simulated ₹ Recovered
              </span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono">
                {metrics?.metrics.recoveryRatePercent ?? 0}% Rate
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight font-mono">
              ₹{metrics?.metrics.simulatedRecoveredRevenueINR.toLocaleString('en-IN') ?? '0'}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
              <span>Recovered Payments:</span>
              <span className="font-semibold text-emerald-400 font-mono">
                {metrics?.metrics.totalRecoveredPayments ?? 0}
              </span>
            </div>
          </div>

          {/* KPI 2: Total At-Risk Revenue */}
          <div className="bg-gradient-to-br from-rose-950/30 to-slate-900 border border-rose-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-medium text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Total At-Risk Revenue
              </span>
              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-mono">
                Decline Pipeline
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight font-mono">
              ₹{metrics?.metrics.atRiskRevenueINR.toLocaleString('en-IN') ?? '0'}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
              <span>Failed Events:</span>
              <span className="font-semibold text-rose-400 font-mono">
                {metrics?.metrics.totalFailedPayments ?? 0}
              </span>
            </div>
          </div>

          {/* KPI 3: Stopped by Safety Rules */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-900/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-medium text-slate-300 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Policy Stopped (DENY)
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                Safety First
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight font-mono">
              {metrics?.decisionsBreakdown.DENY ?? 0}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
              <span>Fraud, Retries & Blocked:</span>
              <span className="font-semibold text-amber-400">Zero Loss</span>
            </div>
          </div>

          {/* KPI 4: Human Approval Queued */}
          <div
            onClick={() => setActiveTab('review')}
            className={`bg-gradient-to-br from-indigo-950/30 to-slate-900 border ${
              escalations.length > 0 ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-indigo-500/30'
            } rounded-2xl p-5 shadow-lg cursor-pointer hover:border-indigo-400 transition`}
          >
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-medium text-indigo-400 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" /> Human Escalations
              </span>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
                {escalations.length} Pending
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight font-mono">
              {escalations.length}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
              <span>High-Value Reviews:</span>
              <span className="font-semibold text-indigo-300 font-mono flex items-center gap-1">
                Open Queue <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </section>

        {/* Batch Recovery Control Bar */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-emerald-400" /> Batch Recovery Engine
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Run the end-to-end recovery pipeline on unrecovered failed payments with automated AI diagnosis and deterministic policy guards.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Dry-run toggle */}
              <label className="flex items-center gap-2 cursor-pointer bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
                <input
                  type="checkbox"
                  checked={batchDryRun}
                  onChange={(e) => setBatchDryRun(e.target.checked)}
                  className="rounded border-slate-600 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-slate-700"
                />
                <span className="font-medium text-slate-300">Dry-Run (Simulation Only)</span>
              </label>

              {/* Batch Limit */}
              <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 px-2.5 py-1.5 rounded-xl text-xs">
                <span className="text-slate-400">Batch Size:</span>
                <select
                  value={batchLimit}
                  onChange={(e) => setBatchLimit(Number(e.target.value))}
                  className="bg-transparent border-0 text-white font-medium focus:ring-0 text-xs py-0"
                >
                  <option value={10} className="bg-slate-800">10 Events</option>
                  <option value={20} className="bg-slate-800">20 Events</option>
                  <option value={50} className="bg-slate-800">50 Events</option>
                  <option value={100} className="bg-slate-800">100 Events</option>
                </select>
              </div>

              {/* Action Button */}
              <button
                onClick={runBatchRecovery}
                disabled={batchLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${batchLoading ? 'animate-bounce' : ''}`} />
                {batchLoading ? 'Processing Batch...' : batchDryRun ? 'Run Dry-Run Simulation' : 'Execute Batch Recovery'}
              </button>
            </div>
          </div>

          {batchResultBanner && (
            <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-3 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{batchResultBanner}</span>
            </div>
          )}
        </section>

        {/* Human Escalation Queue Section (Shown when Review tab is selected or has pending items) */}
        {activeTab === 'review' ? (
          <section className="bg-slate-900 border border-indigo-500/40 rounded-2xl overflow-hidden shadow-xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-indigo-400" /> Human Escalation Queue
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Transactions flagged by deterministic rules (High Value ≥ ₹50,000, Low AI Confidence, or Ambiguous Errors) requiring operator review before action.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('all')}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                Back to All Transactions
              </button>
            </div>

            {escalations.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs italic">
                🎉 No pending escalations. All transactions are resolved or automated cleanly!
              </div>
            ) : (
              <div className="space-y-3">
                {escalations.map((esc) => (
                  <div
                    key={esc.decisionId}
                    className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition"
                  >
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white text-sm">
                          ₹{esc.amountINR.toLocaleString('en-IN')}
                        </span>
                        <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] px-2 py-0.5 rounded font-mono uppercase">
                          {esc.reasonCode}
                        </span>
                        <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded uppercase font-mono">
                          {esc.paymentMethod}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 font-mono text-[11px]">
                        <span>Payment: {esc.paymentId}</span>
                        <span>•</span>
                        <span>Cust: {esc.externalCustomerId}</span>
                        <span>•</span>
                        <span className="text-amber-400">Decline: {esc.failureReason}</span>
                      </div>
                      {esc.aiReasoningFactors.length > 0 && (
                        <div className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 mt-1">
                          <span className="text-slate-500 font-mono text-[10px]">AI Diagnosis: </span>
                          <span className="text-emerald-300">{esc.aiDiagnosis} ({(esc.aiConfidence! * 100).toFixed(0)}% conf)</span>
                          <p className="text-[11px] text-slate-400 mt-0.5">{esc.aiReasoningFactors.join(' • ')}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(esc.decisionId)}
                        disabled={actionLoadingId === esc.decisionId}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow transition disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve & Recover
                      </button>
                      <button
                        onClick={() => handleReject(esc.decisionId)}
                        disabled={actionLoadingId === esc.decisionId}
                        className="bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-300 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Reject & Stop
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* Transactions Explorer Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          {/* Table Header & Search Controls */}
          <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Payment Transactions</span>
              <span className="text-xs text-slate-500 font-mono">({filteredPayments.length} of {payments.length})</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Tab Pills */}
              <div className="flex items-center bg-slate-800/70 p-1 rounded-xl text-xs">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    activeTab === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveTab('recovered')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    activeTab === 'recovered' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Recovered
                </button>
                <button
                  onClick={() => setActiveTab('review')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    activeTab === 'review' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Escalations ({escalations.length})
                </button>
                <button
                  onClick={() => setActiveTab('stopped')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    activeTab === 'stopped' ? 'bg-rose-500/20 text-rose-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Failed / Stopped
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search payment or reason..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-800/80 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500 w-48"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Transaction ID</th>
                  <th className="py-3 px-4">Amount (₹)</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Decline Code</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Audit Trail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredPayments.slice(0, 25).map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => inspectPayment(p)}
                    className="hover:bg-slate-800/40 cursor-pointer transition"
                  >
                    <td className="py-3 px-4 font-mono text-slate-200">
                      <div>{p.id}</div>
                      <div className="text-[10px] text-slate-500">{p.gatewayPaymentId}</div>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-white">
                      ₹{p.amountINR.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4">
                      <span className="bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-[11px] uppercase font-mono">
                        {p.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-amber-300/90">
                      {p.failureReason ?? 'UNKNOWN'}
                    </td>
                    <td className="py-3 px-4">
                      {p.status === 'recovered' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> Recovered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded-full font-medium text-[11px]">
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">
                      <button className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 ml-auto">
                        Inspect <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI Diagnosis Playground */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" /> AI Diagnostic Playground
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Test how the AI diagnostic specialist analyzes any failure reason and outputs strictly validated recovery recommendations.
              </p>
            </div>
            <button
              onClick={runPlaygroundTest}
              disabled={playgroundLoading}
              className="bg-purple-600 hover:bg-purple-500 text-white font-medium px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
              {playgroundLoading ? 'Diagnosing...' : 'Test Diagnosis'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <label className="block text-xs text-slate-400 font-medium">Failure Reason:</label>
              <select
                value={playgroundReason}
                onChange={(e) => setPlaygroundReason(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="NETWORK_ERROR">NETWORK_ERROR (Transient blip)</option>
                <option value="INSUFFICIENT_FUNDS">INSUFFICIENT_FUNDS (Balance decline)</option>
                <option value="BANK_DECLINED_GENERIC">BANK_DECLINED_GENERIC (Generic decline)</option>
                <option value="AUTH_FAILURE">AUTH_FAILURE (3DS / OTP lapse)</option>
                <option value="EXPIRED_CARD">EXPIRED_CARD (Card lapsed)</option>
                <option value="FRAUD_SUSPECTED">FRAUD_SUSPECTED (High risk block)</option>
                <option value="UNKNOWN">UNKNOWN (Unmapped)</option>
              </select>

              <label className="block text-xs text-slate-400 font-medium pt-2">Payment Method:</label>
              <select
                value={playgroundMethod}
                onChange={(e) => setPlaygroundMethod(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="netbanking">Netbanking</option>
                <option value="wallet">Wallet</option>
                <option value="emi">EMI</option>
              </select>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs font-mono">
              <div className="text-slate-500 mb-1">// Diagnostic Output & Reasoning:</div>
              {playgroundResult ? (
                <div className="space-y-2">
                  <div className="text-emerald-400">
                    Recommended Action: <strong className="text-white">{playgroundResult.aiResponse?.recommendedAction}</strong>
                  </div>
                  <div className="text-slate-300">
                    Confidence: {(playgroundResult.aiResponse?.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="text-slate-400 text-[11px] pt-1">
                    Reasoning Factors:
                    <ul className="list-disc list-inside mt-1 text-slate-300 space-y-0.5">
                      {playgroundResult.aiResponse?.reasoningFactors.map((r: string, idx: number) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-slate-600 italic">Select a failure scenario above and click 'Test Diagnosis'.</div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Transaction Details & Full Lifecycle Timeline Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 p-5">
              <div>
                <h3 className="font-bold text-white text-base">Payment Audit Trail & Lifecycle Timeline</h3>
                <p className="text-xs text-slate-400 font-mono">{selectedPayment.id} • {selectedPayment.gatewayPaymentId}</p>
              </div>
              <button
                onClick={() => setSelectedPayment(null)}
                className="text-slate-400 hover:text-white text-sm p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
              {/* Summary Bar */}
              <div className="grid grid-cols-4 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500">Amount:</span>
                  <div className="text-white font-bold">₹{selectedPayment.amountINR.toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <span className="text-slate-500">Method:</span>
                  <div className="text-white uppercase">{selectedPayment.paymentMethod}</div>
                </div>
                <div>
                  <span className="text-slate-500">Decline Code:</span>
                  <div className="text-amber-400">{selectedPayment.failureReason ?? 'UNKNOWN'}</div>
                </div>
                <div>
                  <span className="text-slate-500">Status:</span>
                  <div className={selectedPayment.status === 'recovered' ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                    {selectedPayment.status.toUpperCase()}
                  </div>
                </div>
              </div>

              {/* Chronological Lifecycle Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-400" /> End-to-End Lifecycle Trail
                </h4>

                {inspectLoading ? (
                  <div className="text-center py-6 text-slate-500">Loading full lifecycle trail...</div>
                ) : timeline.length > 0 ? (
                  <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                    {timeline.map((ev) => (
                      <div key={ev.step} className="flex items-start gap-3 relative">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border z-10 ${
                            ev.badgeType === 'success'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : ev.badgeType === 'warning'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : ev.badgeType === 'error'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {ev.step}
                        </div>
                        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white text-xs">{ev.title}</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(ev.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">{ev.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500 italic py-4 text-center">No timeline events recorded yet.</div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-800 p-4 bg-slate-950/40">
              <button
                onClick={() => setSelectedPayment(null)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 rounded-xl transition"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
