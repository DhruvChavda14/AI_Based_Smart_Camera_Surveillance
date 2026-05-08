import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Download, SlidersHorizontal, Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAnalytics, syncAlerts } from '../services/api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Title,
  Tooltip,
  Legend
);

const CHART_OPTS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { color: '#9ca3af', font: { size: 12 }, boxWidth: 12 } },
    title: { display: false },
    tooltip: {
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(75, 85, 99, 0.5)',
      borderWidth: 1,
      titleColor: '#f3f4f6',
      bodyColor: '#d1d5db',
      padding: 10,
    },
  },
  scales: {
    y: {
      grid: { color: 'rgba(55, 65, 81, 0.6)', drawBorder: false },
      ticks: { color: '#9ca3af', font: { size: 11 } },
      beginAtZero: true,
    },
    x: {
      grid: { color: 'rgba(55, 65, 81, 0.4)', drawBorder: false },
      ticks: { color: '#9ca3af', font: { size: 11 } },
    },
  },
};

const Analytics = () => {
  const { user } = useAuth();
  const canAlterData = user?.role === 'admin' || user?.role === 'analyst';

  const [analytics, setAnalytics] = useState(null);
  const [hours, setHours] = useState(24);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const fetchAnalytics = useCallback(async (isPolling = false) => {
    try {
      const res = await getAnalytics(`?hours=${hours}`);
      setAnalytics(res.data);
    } catch {
      if (!isPolling) {
        setAnalytics({
          eventsByHour: [],
          incidentsByType: [],
          resolutionStatus: { Resolved: 0, Unresolved: 0, Investigating: 0 },
          total: 0,
          since: new Date().toISOString(),
          hours,
        });
      }
    }
  }, [hours]);

  useEffect(() => {
    fetchAnalytics(false);
    const interval = setInterval(() => fetchAnalytics(true), 10000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAlerts();
      setSyncMsg(`✓ Synced ${res.data?.synced ?? 0} (${res.data?.inserted ?? 0} new)`);
      await fetchAnalytics(false);
    } catch (e) {
      setSyncMsg(`✗ ${e.response?.data?.message || e.message || 'Sync failed'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const lineChartData = useMemo(() => {
    const events = analytics?.eventsByHour || [];
    const labels = events.map((e) => {
      const hr = Number(e.h);
      if (Number.isFinite(hr)) return `${hr.toString().padStart(2, '0')}:00`;
      return '—';
    });
    const data = events.map((e) => Number(e.count) || 0);
    return {
      labels,
      datasets: [
        {
          label: 'Detection Events',
          data,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: 'rgb(59, 130, 246)',
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };
  }, [analytics]);

  const barChartData = useMemo(() => {
    const types = analytics?.incidentsByType || [];
    const labels = types.map((t) => String(t.type || 'UNKNOWN'));
    const data = types.map((t) => Number(t.count) || 0);
    const COLORS = [
      { bg: 'rgba(239, 68, 68, 0.75)', border: 'rgb(239, 68, 68)' },
      { bg: 'rgba(249, 115, 22, 0.75)', border: 'rgb(249, 115, 22)' },
      { bg: 'rgba(245, 158, 11, 0.75)', border: 'rgb(245, 158, 11)' },
      { bg: 'rgba(168, 85, 247, 0.75)', border: 'rgb(168, 85, 247)' },
      { bg: 'rgba(59, 130, 246, 0.75)', border: 'rgb(59, 130, 246)' },
      { bg: 'rgba(16, 185, 129, 0.75)', border: 'rgb(16, 185, 129)' },
      { bg: 'rgba(236, 72, 153, 0.75)', border: 'rgb(236, 72, 153)' },
      { bg: 'rgba(14, 165, 233, 0.75)', border: 'rgb(14, 165, 233)' },
    ];
    return {
      labels,
      datasets: [
        {
          label: 'Count',
          data,
          backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length].bg),
          borderColor: labels.map((_, i) => COLORS[i % COLORS.length].border),
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [analytics]);

  const doughnutData = useMemo(() => {
    const rs = analytics?.resolutionStatus || {};
    const resolved = Number(rs.Resolved) || 0;
    const unresolved = Number(rs.Unresolved) || 0;
    const investigating = Number(rs.Investigating) || 0;
    return {
      labels: ['Resolved', 'Unresolved', 'Investigating'],
      datasets: [
        {
          data: [resolved, unresolved, investigating],
          backgroundColor: [
            'rgba(16, 185, 129, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(59, 130, 246, 0.8)',
          ],
          borderColor: [
            'rgb(16, 185, 129)',
            'rgb(239, 68, 68)',
            'rgb(59, 130, 246)',
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [analytics]);

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#9ca3af', padding: 16, font: { size: 12 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        borderColor: 'rgba(75, 85, 99, 0.5)',
        borderWidth: 1,
        titleColor: '#f3f4f6',
        bodyColor: '#d1d5db',
      },
    },
    cutout: '72%',
  };

  const rs = analytics?.resolutionStatus || {};
  const total = analytics?.total ?? 0;
  const resolved = Number(rs.Resolved) || 0;
  const unresolved = Number(rs.Unresolved) || 0;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  const topType = analytics?.incidentsByType?.[0];

  const kpis = [
    {
      label: 'Total Detections',
      value: total,
      icon: Activity,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
    },
    {
      label: 'Unresolved',
      value: unresolved,
      icon: AlertTriangle,
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
    },
    {
      label: 'Resolved',
      value: resolved,
      icon: CheckCircle2,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
    },
    {
      label: 'Resolution Rate',
      value: `${resolutionRate}%`,
      icon: TrendingUp,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
    },
    {
      label: 'Top Threat',
      value: topType?.type || '—',
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">System Analytics</h1>
          <p className="text-gray-400 text-sm mt-1">AI model detection metrics and incident trends</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Time range selector */}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 bg-gray-800 text-gray-300 rounded-lg border border-gray-600 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={48}>Last 48h</option>
            <option value={168}>Last 7 days</option>
          </select>

          {syncMsg && (
            <span className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
              syncMsg.startsWith('✓') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}>
              {syncMsg}
            </span>
          )}

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30 hover:bg-blue-600/30 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </button>

          {canAlterData && (
            <>
              <button className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg border border-gray-600 hover:bg-gray-700 hover:text-white transition-colors text-sm font-medium">
                <SlidersHorizontal className="w-4 h-4" />
                Parameters
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg border border-transparent hover:bg-blue-700 transition-colors text-sm font-medium shadow-lg shadow-blue-500/20">
                <Download className="w-4 h-4" />
                Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`bg-gray-800/60 rounded-xl p-4 border ${border} flex items-center gap-3`}>
            <div className={`p-2 rounded-lg ${bg} shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400 font-medium truncate">{label}</p>
              <p className="text-lg font-bold text-white truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line chart - full width */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-white">Detection Events Over Time</h2>
            <span className="text-xs text-gray-500 font-mono bg-gray-900/50 px-2 py-1 rounded border border-gray-700">
              {analytics?.since ? `Since ${new Date(analytics.since).toLocaleDateString()}` : `Last ${hours}h`}
            </span>
          </div>
          <div className="h-[280px]">
            {(analytics?.eventsByHour || []).length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                <Activity className="w-10 h-10 opacity-30" />
                <p className="text-sm">No detection data for this period</p>
                <p className="text-xs text-gray-600">Try syncing alerts or extending the time range</p>
              </div>
            ) : (
              <Line data={lineChartData} options={CHART_OPTS_BASE} />
            )}
          </div>
        </div>

        {/* Bar chart */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-base font-bold text-white mb-5">Incidents by Threat Type</h2>
          <div className="h-[280px]">
            {(analytics?.incidentsByType || []).length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                <AlertTriangle className="w-10 h-10 opacity-30" />
                <p className="text-sm">No threat type data</p>
              </div>
            ) : (
              <Bar data={barChartData} options={CHART_OPTS_BASE} />
            )}
          </div>
        </div>

        {/* Doughnut chart */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-base font-bold text-white mb-5">Alert Resolution Status</h2>
          <div className="h-[280px] relative">
            {total === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                <CheckCircle2 className="w-10 h-10 opacity-30" />
                <p className="text-sm">No alert data yet</p>
                <p className="text-xs text-gray-600">Click "Sync" to pull alerts from the model</p>
              </div>
            ) : (
              <>
                <Doughnut data={doughnutData} options={doughnutOptions} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: '-28px' }}>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-white block">{total}</span>
                    <span className="text-xs text-gray-400 uppercase tracking-widest">Total</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
