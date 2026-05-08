import {
  Search, Download, AlertTriangle, CheckCircle2,
  Loader2, Eye, Camera
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAlerts, screenshotUrl } from '../services/api';


const SEVERITY_STYLES = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  Warning:  'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Info:     'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const Incidents = () => {
  // No localStorage — always from MongoDB
  const [alerts, setAlerts]         = useState([]);
  const [query, setQuery]           = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter]     = useState('All');
  const [loading, setLoading]       = useState(true);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [imgError, setImgError]     = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchAlerts = async (isPolling = false) => {
      try {
        const res = await getAlerts();
        if (!mounted) return;
        setAlerts(res.data?.alerts || []);
      } catch {
        if (!mounted || isPolling) return;
        setAlerts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchAlerts(false);
    const interval = setInterval(() => fetchAlerts(true), 7000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const mapped = (alerts || []).map((a) => {
      const dt = a.modelTimestamp ? new Date(a.modelTimestamp) : null;
      return {
        id:             a.externalId || a._id,
        mongoId:        a._id,
        date:           dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleString() : '—',
        type:           a.threatType || 'UNKNOWN',
        location:       a.cameraId || 'CAM',
        severity:       a.severity || 'Info',
        status:         a.status || 'Unresolved',
        imageId:        a.imageId,
        screenshotPath: a.screenshotPath,
        confidence:     a.confidence,
        message:        a.message,
      };
    });

    let filtered = mapped;
    if (severityFilter !== 'All') filtered = filtered.filter((r) => r.severity === severityFilter);
    if (statusFilter   !== 'All') filtered = filtered.filter((r) => r.status   === statusFilter);
    if (q) {
      filtered = filtered.filter((r) =>
        [r.id, r.type, r.location, r.severity, r.status, r.date, r.message].some((v) =>
          String(v || '').toLowerCase().includes(q)
        )
      );
    }
    return filtered;
  }, [alerts, query, severityFilter, statusFilter]);

  const handleExportCSV = () => {
    const headers = ['Incident ID', 'Date & Time', 'Threat Type', 'Camera', 'Severity', 'Status', 'Confidence', 'Image Stored'];
    const csvRows = [
      headers.join(','),
      ...rows.map((r) => [
        `"${r.id}"`,
        `"${r.date}"`,
        `"${r.type}"`,
        `"${r.location}"`,
        `"${r.severity}"`,
        `"${r.status}"`,
        typeof r.confidence === 'number' ? `${Math.round(r.confidence * 100)}%` : '—',
        r.imageId ? 'Yes (MongoDB)' : r.screenshotPath ? 'Pending' : 'No',
      ].join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `incidents_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const criticalCount  = rows.filter((r) => r.severity === 'Critical').length;
  const unresolvedCount= rows.filter((r) => r.status === 'Unresolved').length;
  const withImages     = rows.filter((r) => r.imageId).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Incident History</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {rows.length} incident{rows.length !== 1 ? 's' : ''}
            {criticalCount   > 0 && <span className="text-red-400 ml-2">• {criticalCount} critical</span>}
            {unresolvedCount > 0 && <span className="text-amber-400 ml-2">• {unresolvedCount} unresolved</span>}
            {withImages      > 0 && <span className="text-green-400 ml-2">• {withImages} images in MongoDB</span>}
          </p>
        </div>

        <div className="flex w-full sm:w-auto gap-2 flex-wrap">
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search incidents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="All">All Severity</option>
            <option value="Critical">Critical</option>
            <option value="Warning">Warning</option>
            <option value="Info">Info</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="All">All Status</option>
            <option value="Unresolved">Unresolved</option>
            <option value="Resolved">Resolved</option>
          </select>
          <button
            onClick={handleExportCSV}
            disabled={rows.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-400 whitespace-nowrap">
          <thead className="bg-gray-900/60 text-xs uppercase text-gray-500 border-b border-gray-700">
            <tr>
              <th className="px-5 py-4 font-medium">Incident ID</th>
              <th className="px-5 py-4 font-medium">Date &amp; Time</th>
              <th className="px-5 py-4 font-medium">Threat Type</th>
              <th className="px-5 py-4 font-medium">Camera</th>
              <th className="px-5 py-4 font-medium">Confidence</th>
              <th className="px-5 py-4 font-medium">Severity</th>
              <th className="px-5 py-4 font-medium">Status</th>
              <th className="px-5 py-4 font-medium">Image</th>
              <th className="px-5 py-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                    <span>Loading from MongoDB…</span>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-500">
                    <CheckCircle2 className="w-8 h-8 text-green-500/40" />
                    <span className="text-gray-300 font-medium">No incidents found</span>
                    <span className="text-xs">Use Sync &amp; Store on the Dashboard or Alerts page</span>
                  </div>
                </td>
              </tr>
            ) : rows.map((incident) => (
              <tr key={incident.id} className="hover:bg-gray-700/30 transition-colors">
                <td className="px-5 py-3.5 font-mono text-xs text-gray-400 max-w-[160px] truncate" title={String(incident.id)}>
                  {String(incident.id).slice(-16)}
                </td>
                <td className="px-5 py-3.5 text-gray-300">{incident.date}</td>
                <td className="px-5 py-3.5 font-medium text-gray-200">{incident.type}</td>
                <td className="px-5 py-3.5 text-gray-300">{incident.location}</td>
                <td className="px-5 py-3.5">
                  {typeof incident.confidence === 'number' ? (
                    <div className="flex items-center gap-2">
                      <div className="w-14 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${incident.confidence > 0.7 ? 'bg-red-500' : incident.confidence > 0.4 ? 'bg-amber-500' : 'bg-blue-500'}`}
                          style={{ width: `${Math.round(incident.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-400">{Math.round(incident.confidence * 100)}%</span>
                    </div>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.Info}`}>
                    {incident.severity}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${incident.status === 'Resolved' ? 'text-green-400' : 'text-amber-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${incident.status === 'Resolved' ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
                    {incident.status}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  {incident.imageId ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">🗄 MongoDB</span>
                  ) : incident.screenshotPath ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-gray-700 text-gray-400 border-gray-600">⏳ Pending</span>
                  ) : (
                    <span className="text-gray-600 text-xs">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  {(incident.imageId || incident.screenshotPath) ? (
                    <button
                      onClick={() => { setImgError(false); setSelectedIncident(incident); }}
                      className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium text-xs transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Frame
                    </button>
                  ) : (
                    <span className="text-gray-600 text-xs">No frame</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selectedIncident && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
              <div>
                <div className="text-white font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  {selectedIncident.type} — {selectedIncident.location}
                </div>
                <div className="text-gray-400 text-xs mt-0.5 font-mono flex items-center gap-2">
                  {selectedIncident.date}
                  {selectedIncident.imageId
                    ? <span className="text-green-400 font-semibold">🗄 MongoDB</span>
                    : <span className="text-gray-500">⏳ Pending sync</span>}
                </div>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="px-4 py-2 bg-gray-800 text-gray-200 rounded-lg border border-gray-600 hover:bg-gray-700 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
            <div className="p-5">
              {imgError ? (
                <div className="h-52 flex flex-col items-center justify-center bg-gray-800/50 rounded-xl border border-dashed border-gray-700 text-gray-500 gap-2">
                  <Camera className="w-8 h-8 opacity-40" />
                  <p className="text-sm">
                    {selectedIncident.imageId ? 'Image unavailable from MongoDB' : 'Image unavailable (model offline)'}
                  </p>
                </div>
              ) : (
                <img
                  src={screenshotUrl(selectedIncident.imageId, selectedIncident.screenshotPath)}
                  alt="Incident frame"
                  className="w-full rounded-xl object-contain max-h-[55vh] bg-black/50"
                  onError={() => setImgError(true)}
                />
              )}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Threat Type',    value: selectedIncident.type },
                  { label: 'Severity',       value: selectedIncident.severity },
                  { label: 'Status',         value: selectedIncident.status },
                  {
                    label: 'Confidence',
                    value: typeof selectedIncident.confidence === 'number'
                      ? `${Math.round(selectedIncident.confidence * 100)}%`
                      : '—',
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                    <span className="text-gray-500 text-xs uppercase tracking-wider font-bold block mb-1">{label}</span>
                    <span className="text-gray-200 font-medium text-sm">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Incidents;
