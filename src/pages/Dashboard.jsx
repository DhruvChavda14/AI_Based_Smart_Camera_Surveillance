import {
  Bell, Camera, AlertTriangle, ShieldCheck,
  Loader2, RefreshCw, Activity, TrendingUp
} from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { getAlerts, getCameras, syncAlerts, screenshotUrl } from '../services/api';

const Dashboard = () => {
  const [cameras, setCameras] = useState([]);
  const [alerts, setAlerts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [imgErrors, setImgErrors] = useState(() => new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg]     = useState(null);

  const fetchAll = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) setError(null);
      const [camsRes, alertsRes] = await Promise.all([getCameras(), getAlerts()]);
      setCameras(Array.isArray(camsRes.data) ? camsRes.data : []);
      setAlerts(alertsRes.data?.alerts || []);
    } catch (e) {
      if (!isPolling) setError(e.response?.data?.message || e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(false);
    const interval = setInterval(() => fetchAll(true), 6000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAlerts();
      const { synced = 0, inserted = 0, imagesStored = 0 } = res.data ?? {};
      setSyncMsg(`✓ ${synced} alerts · ${inserted} new · ${imagesStored} images stored`);
      await fetchAll(false);
    } catch (e) {
      setSyncMsg(`✗ ${e.response?.data?.message || e.message || 'Sync failed'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  const formatTimeAgo = (isoOrDate) => {
    const dt = isoOrDate ? new Date(isoOrDate) : null;
    if (!dt || Number.isNaN(dt.getTime())) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
    if (sec < 10)  return 'just now';
    if (sec < 60)  return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr  < 24)  return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  };

  const computed = useMemo(() => {
    const totalCams    = cameras.length;
    const onlineCams   = cameras.filter((c) => c.status === 'Online').length;
    const unresolved   = alerts.filter((a) => (a.status || 'Unresolved') !== 'Resolved');
    const critical     = unresolved.filter((a) => String(a.severity || '').toLowerCase() === 'critical');

    // Prefer alerts that already have an imageId stored in MongoDB
    const withImage = alerts.filter((a) => a.imageId || a.screenshotPath);
    const source    = withImage.length ? withImage : alerts;

    const recent = source.slice(0, 6).map((a) => ({
      id:             a._id || a.externalId,
      cam:            a.cameraId || 'CAM',
      time:           formatTimeAgo(a.modelTimestamp),
      alert:          a.message || a.threatType || 'Alert',
      imageId:        a.imageId,
      screenshotPath: a.screenshotPath,
      severity:       a.severity || 'Info',
      threatType:     a.threatType,
    })).filter((x) => x.id);

    // Threat breakdown
    const threatCounts = {};
    for (const a of alerts) {
      const t = a.threatType || 'UNKNOWN';
      threatCounts[t] = (threatCounts[t] || 0) + 1;
    }
    const topThreats = Object.entries(threatCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      totalCams,
      onlineCams,
      unresolvedCount: unresolved.length,
      criticalCount:   critical.length,
      totalAlerts:     alerts.length,
      recent,
      topThreats,
      statusValue: error
        ? 'Degraded'
        : totalCams === 0
          ? 'No Cameras'
          : unresolved.length > 0
            ? 'Monitoring'
            : 'Secure',
    };
  }, [alerts, cameras, error]);

  const severityBadge = (severity) => {
    if (severity === 'Critical') return 'text-red-400 bg-red-500/20 border-red-500/30';
    if (severity === 'Warning')  return 'text-amber-400 bg-amber-500/20 border-amber-500/30';
    return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
  };

  const stats = [
    { title: 'Active Cameras',    value: `${computed.onlineCams}/${computed.totalCams}`, icon: Camera,     color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
    { title: 'Unresolved Alerts', value: computed.unresolvedCount,                       icon: Bell,       color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
    { title: 'Critical Incidents',value: computed.criticalCount,                          icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10',    border: 'border-red-500/20' },
    { title: 'Total Detections',  value: computed.totalAlerts,                            icon: Activity,   color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    {
      title: 'System Status',
      value: computed.statusValue,
      icon: ShieldCheck,
      color:  computed.statusValue === 'Secure' ? 'text-green-400' : 'text-amber-400',
      bg:     computed.statusValue === 'Secure' ? 'bg-green-500/10' : 'bg-amber-500/10',
      border: computed.statusValue === 'Secure' ? 'border-green-500/20' : 'border-amber-500/20',
    },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        <p className="text-gray-400 font-medium">Loading dashboard from MongoDB…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard Overview</h1>
          <p className="text-gray-400 text-sm mt-0.5">Real-time AI surveillance · data from MongoDB</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {syncMsg && (
            <span className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${
              syncMsg.startsWith('✓')
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg border border-blue-500/30 text-sm font-medium transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync & Store Images
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div key={idx} className={`bg-gray-800/60 rounded-xl p-5 border ${stat.border} flex items-center gap-4`}>
              <div className={`p-2.5 rounded-lg ${stat.bg} shrink-0`}>
                <Icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium leading-tight">{stat.title}</p>
                <p className="text-xl font-bold text-white mt-0.5">{stat.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Captures grid */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Latest Model Captures</h2>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono">
              {computed.recent.filter((r) => r.imageId).length}/{computed.recent.length} in MongoDB
            </span>
          </div>

          {computed.recent.length === 0 ? (
            <div className="p-8 bg-gray-800/60 border border-gray-700/50 rounded-xl text-gray-400 text-sm flex flex-col items-center gap-3">
              <Camera className="w-10 h-10 text-gray-600" />
              <div className="text-center">
                <p className="text-gray-300 font-medium">No captures yet</p>
                <p className="text-gray-500 text-xs mt-1">
                  Click <span className="text-blue-400 font-semibold">Sync &amp; Store Images</span> to pull alerts and save screenshots to MongoDB.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {computed.recent.map((img) => {
                const src = screenshotUrl(img.imageId);
                const hasMongoImage = Boolean(img.imageId);
                return (
                  <div key={img.id} className="bg-gray-800/60 rounded-xl overflow-hidden border border-gray-700/50 hover:border-gray-600 transition-colors group">
                    <div className="relative aspect-video bg-gray-900">
                      {src ? (
                        imgErrors.has(img.id) ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-xs gap-2">
                            <Camera className="w-6 h-6 opacity-40" />
                            <span>Screenshot unavailable</span>
                          </div>
                        ) : (
                          <img
                            src={src}
                            alt={`Alert: ${img.alert}`}
                            className="w-full h-full object-cover"
                            onError={() =>
                              setImgErrors((prev) => { const s = new Set(prev); s.add(img.id); return s; })
                            }
                          />
                        )
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-xs gap-2">
                          <Camera className="w-6 h-6 opacity-40" />
                          <span>No screenshot</span>
                        </div>
                      )}

                      {/* Storage badge */}
                      <div className="absolute top-2 right-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          hasMongoImage
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-gray-700/80 text-gray-400 border-gray-600'
                        }`}>
                          {hasMongoImage ? '🗄 MongoDB' : '⏳ Pending'}
                        </span>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-900 via-gray-900/70 to-transparent pt-10 p-3">
                        <div className="flex justify-between items-end gap-2">
                          <div>
                            <p className="font-semibold text-white text-sm">{img.cam}</p>
                            <p className="text-xs text-gray-400">{img.time}</p>
                          </div>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${severityBadge(img.severity)}`}>
                            {img.alert}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Threat Breakdown</h2>

          {computed.topThreats.length === 0 ? (
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-6 text-gray-500 text-sm text-center">
              No threat data yet
            </div>
          ) : (
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-3">
              {computed.topThreats.map(([type, count]) => {
                const pct = computed.totalAlerts > 0 ? Math.round((count / computed.totalAlerts) * 100) : 0;
                const barColor =
                  type.includes('FIRE') || type.includes('SMOKE') ? 'bg-orange-500'
                  : type.includes('GUN') || type.includes('PISTOL') || type.includes('KNIFE') ? 'bg-red-500'
                  : type.includes('VIOLENCE') ? 'bg-purple-500'
                  : 'bg-blue-500';
                return (
                  <div key={type}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-gray-300">{type}</span>
                      <span className="text-xs text-gray-500 font-mono">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MongoDB storage status */}
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Storage Summary
            </h3>
            {[
              { label: 'Total Alerts',     value: computed.totalAlerts, color: 'text-white' },
              { label: 'Unresolved',       value: computed.unresolvedCount, color: 'text-amber-400' },
              { label: 'Critical',         value: computed.criticalCount, color: 'text-red-400' },
              { label: 'Images in MongoDB',value: alerts.filter((a) => a.imageId).length, color: 'text-green-400' },
              { label: 'Pending Upload',   value: alerts.filter((a) => a.screenshotPath && !a.imageId).length, color: 'text-gray-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center text-sm">
                <span className="text-gray-400">{label}</span>
                <span className={`font-bold font-mono ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
