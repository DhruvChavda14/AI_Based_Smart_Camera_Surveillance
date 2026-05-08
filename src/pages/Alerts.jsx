import { AlertTriangle, Clock, Eye, CheckCircle2, ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, memo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAlerts, markAllAlertsRead, resolveAlert, syncAlerts, screenshotUrl } from '../services/api';

// ─── AlertItem component ──────────────────────────────────────────────────────

const AlertItem = memo(({ alert, canResolve, onResolve, onReview, isLast }) => {
  const getAlertColor = (type) => {
    switch (type) {
      case 'Critical': return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'Warning':  return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'Info':     return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      default:         return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    }
  };

  return (
    <div className={`p-4 md:p-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between transition-colors
      ${!isLast ? 'border-b border-gray-700' : ''}
      ${alert.status !== 'Resolved' ? 'bg-gray-800/50 hover:bg-gray-700/50' : 'opacity-70 hover:opacity-100 bg-gray-900/50'}
    `}>
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl border ${getAlertColor(alert.type)} shrink-0`}>
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getAlertColor(alert.type)}`}>
              {alert.type}
            </span>
            <span className="text-sm font-medium text-gray-400">{alert.source}</span>
            {/* Storage indicator */}
              {alert.imageId ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                🗄 MongoDB
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-gray-700/80 text-gray-500 border-gray-600">
                ⏳ Uploading…
              </span>
            )}

          </div>
          <h3 className="text-white font-medium text-lg">{alert.message}</h3>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {alert.time}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:self-center ml-14 sm:ml-0 mt-2 sm:mt-0 max-sm:w-full">
        {alert.status === 'Unresolved' ? (
          canResolve ? (
            <>
              {alert.imageId && (
                <button
                  onClick={() => onReview(alert)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors text-sm font-medium border border-blue-500/20"
                >
                  <Eye className="w-4 h-4" />
                  Review Frame
                </button>
              )}

              <button
                onClick={() => onResolve(alert.id)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-colors text-sm font-medium border border-green-500/20"
              >
                <CheckCircle2 className="w-4 h-4" />
                Resolve
              </button>
            </>
          ) : (
            <span className="px-3 py-1.5 text-amber-500/80 text-sm font-medium flex items-center gap-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <ShieldAlert className="w-4 h-4" />
              Pending Review
            </span>
          )
        ) : (
          <span className="px-3 py-1.5 text-green-500 text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Resolved
          </span>
        )}
      </div>
    </div>
  );
});
AlertItem.displayName = 'AlertItem';

// ─── Main component ───────────────────────────────────────────────────────────

const Alerts = () => {
  const { user } = useAuth();
  const canResolve = user?.role === 'admin' || user?.role === 'operator';

  // No localStorage — always from MongoDB
  const [alerts, setAlerts]           = useState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError]             = useState(null);
  const [activeFrameAlert, setActiveFrameAlert] = useState(null);
  const [activeFrameError, setActiveFrameError] = useState(false);
  const [isActionLoading, setIsActionLoading]   = useState(false);
  const [isRefreshing, setIsRefreshing]         = useState(false);
  const [isSyncing, setIsSyncing]               = useState(false);
  const [syncMsg, setSyncMsg]                   = useState(null);

  const fetchAlerts = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) setError(null);
      if (isPolling) setIsRefreshing(true);
      const res = await getAlerts();
      setAlerts(res.data?.alerts || []);
    } catch (e) {
      if (!isPolling) setError(e.response?.data?.message || e.message || 'Failed to load alerts');
    } finally {
      setIsInitialLoad(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(() => fetchAlerts(true), 5000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const formatTimeAgo = useCallback((isoOrDate) => {
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
  }, []);

  const alertRows = useMemo(() =>
    (alerts || []).map((a) => ({
      id:             a._id,
      type:           a.severity || 'Info',
      source:         a.cameraId || 'CAM-AI-01',
      message:        a.message || a.threatType || 'Alert',
      time:           formatTimeAgo(a.modelTimestamp),
      status:         a.status || 'Unresolved',
      imageId:        a.imageId,          // GridFS ObjectId (string)
      screenshotPath: a.screenshotPath,   // fallback
      threatType:     a.threatType,
      confidence:     a.confidence,
    })),
  [alerts, formatTimeAgo]);

  const handleResolve = useCallback(async (id) => {
    try {
      setIsActionLoading(true);
      await resolveAlert(id);
      await fetchAlerts();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to resolve alert');
    } finally {
      setIsActionLoading(false);
    }
  }, [fetchAlerts]);

  const handleReview = useCallback((alertData) => {
    setActiveFrameError(false);
    setActiveFrameAlert(alertData);
  }, []);

  const onMarkAllRead = async () => {
    try {
      setIsActionLoading(true);
      await markAllAlertsRead();
      await fetchAlerts();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to mark read');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAlerts();
      const { synced = 0, inserted = 0, imagesStored = 0 } = res.data ?? {};
      setSyncMsg(`✓ ${synced} alerts · ${inserted} new · ${imagesStored} images → MongoDB`);
      await fetchAlerts();
    } catch (e) {
      setSyncMsg(`✗ ${e.response?.data?.message || e.message || 'Sync failed'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  if (isInitialLoad) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        <p className="text-gray-400 font-medium">Loading alerts from MongoDB…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center bg-gray-800/40 p-4 rounded-xl border border-gray-700/50 backdrop-blur-sm flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-blue-400" />
            Alert Center
          </h1>
          <p className="text-gray-400 text-sm mt-1">Real-time threats · screenshots stored in MongoDB</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {syncMsg && (
            <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
              syncMsg.startsWith('✓')
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing || isActionLoading}
            className="px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30 hover:bg-blue-600/30 transition-all font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync &amp; Store
          </button>
          {alertRows.some((a) => a.status === 'Unresolved') && (
            <button
              onClick={onMarkAllRead}
              disabled={isActionLoading}
              className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg border border-gray-600 hover:bg-gray-700 transition-all font-medium text-sm flex items-center gap-2 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {isRefreshing && !error && (
        <div className="text-xs text-gray-500 font-mono px-1">Refreshing…</div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl p-4 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          {error}
        </div>
      )}

      {/* Alert list */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
        <div className="flex flex-col">
          {alertRows.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-gray-400">
              <CheckCircle2 className="w-12 h-12 text-green-500/40 mb-4" />
              <p className="text-lg font-medium text-gray-300">No alerts in database</p>
              <p className="text-sm mt-1">Click <span className="text-blue-400 font-semibold">Sync &amp; Store</span> to pull data from the AI model.</p>
            </div>
          ) : alertRows.map((alert, index) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              canResolve={canResolve}
              onResolve={handleResolve}
              onReview={handleReview}
              isLast={index === alertRows.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Screenshot modal */}
      {activeFrameAlert && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-4xl bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
              <div>
                <div className="text-white font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  {activeFrameAlert.message}
                </div>
                <div className="text-gray-400 text-xs mt-1 font-mono flex items-center gap-2">
                  {activeFrameAlert.source} • {activeFrameAlert.time}
                  {activeFrameAlert.imageId ? (
                    <span className="text-green-400 font-semibold">🗄 MongoDB</span>
                  ) : (
                    <span className="text-gray-500">⏳ Not yet stored</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setActiveFrameAlert(null)}
                className="px-4 py-2 bg-gray-800 text-gray-200 rounded-lg border border-gray-600 hover:bg-gray-700 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
            <div className="p-6">
              {(activeFrameAlert.imageId || activeFrameAlert.screenshotPath) ? (
                <div className="relative rounded-xl overflow-hidden bg-black/50 border border-gray-800">
                  {activeFrameError ? (
                    <div className="h-64 flex items-center justify-center bg-gray-800/50 rounded-xl border border-dashed border-gray-700 text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <Eye className="w-8 h-8 opacity-50" />
                        <p className="text-sm">
                          {activeFrameAlert.imageId ? 'Image unavailable from MongoDB' : 'Image unavailable (model offline)'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <img
                      alt="Alert frame"
                      className="w-full object-contain max-h-[60vh]"
                      src={screenshotUrl(activeFrameAlert.imageId)}
                      onError={() => setActiveFrameError(true)}
                    />
                  )}
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center bg-gray-800/50 rounded-xl border border-dashed border-gray-700 text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <Eye className="w-8 h-8 opacity-50" />
                    <p className="text-sm">No screenshot for this alert</p>
                  </div>
                </div>
              )}
              <div className="mt-6 flex items-center gap-6 bg-gray-800/30 p-4 rounded-xl border border-gray-800/50 flex-wrap">
                <div>
                  <span className="text-gray-500 text-xs uppercase tracking-wider font-bold block mb-1">Threat Assessment</span>
                  <span className="text-gray-200 font-medium">{activeFrameAlert.threatType || '—'}</span>
                </div>
                {typeof activeFrameAlert.confidence === 'number' && (
                  <div>
                    <span className="text-gray-500 text-xs uppercase tracking-wider font-bold block mb-1">Confidence Score</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${activeFrameAlert.confidence > 0.8 ? 'bg-red-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.round(activeFrameAlert.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-200 font-mono text-sm">{Math.round(activeFrameAlert.confidence * 100)}%</span>
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-gray-500 text-xs uppercase tracking-wider font-bold block mb-1">Image Storage</span>
                  <span className={`font-medium text-sm ${activeFrameAlert.imageId ? 'text-green-400' : 'text-gray-500'}`}>
                    {activeFrameAlert.imageId ? '🗄 Stored in MongoDB' : '⏳ Not yet stored — run Sync'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Alerts;
