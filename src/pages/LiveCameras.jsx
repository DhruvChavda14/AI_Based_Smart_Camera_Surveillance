import React, { useState, useEffect, memo, useCallback, useMemo } from 'react';
import { Camera, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCameras } from '../services/api';
import { modelService } from '../services/modelService';

const CameraCard = memo(({ cam, cameraAlerts }) => {
  const activeAlert = cameraAlerts?.[0];
  const hasActiveAlert = !!activeAlert;
  const [streamOk, setStreamOk] = useState(true);
  
  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-lg transition-all hover:shadow-xl hover:border-gray-600 group">
      <div className="relative aspect-video bg-gray-900 group">
        {cam.status === 'Offline' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-gray-800/50">
            <Camera className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-sm font-medium">Camera Offline</span>
          </div>
        ) : (
          <>
            {!streamOk ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-gray-800/50">
                <Camera className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm font-medium">Stream unavailable</span>
              </div>
            ) : null}
            <img
              src={cam.ip} 
              alt={`Live feed from ${cam.name}`} 
              className={`w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-300 ${streamOk ? '' : 'hidden'}`}
              onLoad={() => setStreamOk(true)}
              onError={(e) => {
                // No fallback images; just show "Stream unavailable"
                setStreamOk(false);
              }}
            />
            {hasActiveAlert && (
              <div className="absolute inset-0 border-[3px] border-red-500/80 animate-pulse pointer-events-none transition-all duration-300 shadow-[inset_0_0_20px_rgba(239,68,68,0.5)]"></div>
            )}
          </>
        )}
        
        <div className="absolute top-3 left-3 flex gap-2 z-10">
          <span className={`px-2 py-1 rounded text-xs font-bold backdrop-blur-md border shadow-sm ${
            cam.status === 'Online' 
              ? 'bg-green-500/20 text-green-400 border-green-500/30' 
              : 'bg-red-500/20 text-red-400 border-red-500/30'
          }`}>
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${cam.status === 'Online' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></span>
              {cam.status}
            </span>
          </span>
        </div>
      </div>
      
      <div className="p-4 border-t border-gray-700 bg-gray-800/80 backdrop-blur-sm">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">{cam.name}</h3>
            <p className="text-gray-400 uppercase tracking-wider text-xs mt-1 font-mono">{cam.cameraId}</p>
          </div>
        </div>
      </div>
    </div>
  );
});

CameraCard.displayName = 'CameraCard';

const LiveCameras = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [cameras, setCameras] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (isPolling = false) => {
    try {
      const [camerasRes, alertsRes] = await Promise.all([
        getCameras(),
        modelService.getLatestAlerts().catch(() => ({ alerts: [] }))
      ]);
      
      setCameras(prev => {
        const newCams = camerasRes.data || [];
        // simple heuristic to reduce unnecessary re-renders
        if (prev.length !== newCams.length) return newCams;
        if (JSON.stringify(prev) !== JSON.stringify(newCams)) return newCams;
        return prev;
      });

      setAlerts(prev => {
        const newAlerts = alertsRes.alerts || [];
        if (prev.length !== newAlerts.length) return newAlerts;
        if (JSON.stringify(prev) !== JSON.stringify(newAlerts)) return newAlerts;
        return prev;
      });

      if (!isPolling) setError(null);
    } catch (err) {
      console.error('Failed to fetch live feed data', err);
      if (!isPolling) setError('Unable to connect to server. Check that the backend is running.');
    } finally {
      setIsInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Memoize grouped alerts by camera ID to easily pass into CameraCard
  const alertsByCamera = useMemo(() => {
    const grouped = {};
    alerts.forEach(alert => {
      const cid = alert.cameraId || alert.camera_id;
      if (cid) {
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push(alert);
      }
    });
    return grouped;
  }, [alerts]);

  if (isInitialLoad) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        <p className="text-gray-400 font-medium">Initializing secure video streams...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-800/40 p-4 rounded-xl border border-gray-700/50 backdrop-blur-sm">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Camera className="w-6 h-6 text-blue-400" />
            Live Camera Feeds
          </h1>
          <p className="text-gray-400 text-sm mt-1">Real-time surveillance and AI threat analysis</p>
        </div>
        
        <div className="flex gap-3 items-center">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            <span className="text-xs text-gray-400 font-mono">LIVE • {cameras.filter(c => c.status === 'Online').length}/{cameras.length}</span>
          </div>
          {isAdmin && (
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 text-sm font-medium border border-blue-500/50 hover:shadow-blue-500/40 focus:ring-2 focus:ring-blue-500/50">
              Add Camera
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl p-4 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          {error}
        </div>
      )}

      {cameras.length === 0 && !error ? (
        <div className="p-12 flex flex-col items-center justify-center text-gray-400 bg-gray-800/30 rounded-xl border border-dashed border-gray-700 mt-6">
          <Camera className="w-12 h-12 text-gray-600 mb-4 opacity-50" />
          <p className="text-lg font-medium text-gray-300">No cameras configured</p>
          <p className="text-sm">Add a camera to begin monitoring your perimeter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {cameras.map((cam) => (
            <CameraCard key={cam.cameraId} cam={cam} cameraAlerts={alertsByCamera[cam.cameraId]} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveCameras;
