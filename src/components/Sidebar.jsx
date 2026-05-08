import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Video, 
  Bell, 
  History, 
  Activity, 
  Settings,
  X 
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Sidebar = ({ sidebarOpen, setSidebarOpen }) => {
  const { user } = useAuth();
  const role = user?.role || 'viewer';

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'operator', 'analyst', 'viewer'] },
    { name: 'Live Cameras', href: '/cameras', icon: Video, roles: ['admin', 'operator', 'viewer'] },
    { name: 'Alerts', href: '/alerts', icon: Bell, roles: ['admin', 'operator', 'viewer'] },
    { name: 'Incident History', href: '/incidents', icon: History, roles: ['admin', 'operator', 'analyst'] },
    { name: 'Analytics', href: '/analytics', icon: Activity, roles: ['admin', 'operator', 'analyst'] },
    { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
  ];

  // Filter based on roles
  const allowedNav = navigation.filter(item => item.roles.includes(role));

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar container */}
      <aside 
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-gray-800 border-r border-gray-700 transition-transform duration-300 ease-in-out transform 
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:inset-auto`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white tracking-wide">SecureAI</span>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {allowedNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium
                  ${isActive 
                    ? 'bg-blue-600/10 text-blue-500' 
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
