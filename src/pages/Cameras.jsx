import React, { useState, useEffect } from 'react';
import { Camera, Settings2, Trash2, Plus, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCameras } from '../services/api';

const Cameras = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await getCameras();
        setSettings(response.data || []);
      } catch (error) {
        console.error('Failed to load cameras', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  if (loading) return <div className="text-white">Loading cameras...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Camera Management</h1>
          <p className="text-gray-400 text-sm mt-1">Configure sources for AI analysis</p>
        </div>
        {isAdmin && (
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30 font-medium text-sm">
            <Plus className="w-4 h-4" />
            Add New Camera
          </button>
        )}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <ul className="divide-y divide-gray-700">
          {settings.map((cam) => (
            <li key={cam.cameraId} className="p-4 sm:p-6 lg:flex lg:items-center lg:justify-between hover:bg-gray-700/30 transition-colors">
              <div className="flex items-start lg:items-center gap-4">
                <div className={`p-3 rounded-xl border ${
                  cam.status === 'Online' 
                    ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' 
                    : 'bg-gray-700 border-gray-600 text-gray-500'
                }`}>
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-white font-medium text-lg mb-0.5">{cam.name}</h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs uppercase tracking-wide">ID:</span>
                      {cam.cameraId}
                    </span>
                    <span className="hidden sm:inline text-gray-600">•</span>
                    <span className="flex items-center gap-1.5 font-mono text-xs bg-gray-900 px-2 py-0.5 rounded text-gray-300">
                      {cam.ip}
                    </span>
                    <span className="hidden sm:inline text-gray-600">•</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs uppercase tracking-wide">Res:</span>
                      {cam.resolution}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 lg:mt-0 lg:ml-6 flex items-center justify-between lg:justify-end gap-6 border-t border-gray-700 pt-4 lg:border-t-0 lg:pt-0">
                <span className={`flex items-center gap-2 text-sm font-medium
                  ${cam.status === 'Online' ? 'text-green-500' : 'text-gray-500'}
                `}>
                  {cam.status === 'Online' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  {cam.status}
                </span>

                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors border border-transparent hover:border-gray-600" title="Settings">
                      <Settings2 className="w-5 h-5" />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/20 rounded-lg transition-colors border border-transparent" title="Remove">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {settings.length === 0 && (
            <li className="p-4 sm:p-6 text-center text-gray-400">No cameras configured.</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default Cameras;
