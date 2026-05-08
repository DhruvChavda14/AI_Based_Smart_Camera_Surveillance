import { Menu, Search, User, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const Navbar = ({ sidebarOpen, setSidebarOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="flex items-center justify-between px-4 lg:px-6 py-3 bg-gray-800 border-b border-gray-700">
      <div className="flex items-center gap-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-gray-400 hover:text-white lg:hidden"
        >
          <Menu className="w-6 h-6" />
        </button>
        
        <div className="hidden sm:flex items-center bg-gray-900 border border-gray-700 px-3 py-1.5 rounded-lg focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <Search className="w-4 h-4 text-gray-500 mr-2" />
          <input 
            type="text" 
            placeholder="Search cameras or alerts..." 
            className="bg-transparent border-none text-sm text-gray-200 placeholder-gray-500 focus:outline-none w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex flex-col items-end">
          <span className="text-sm font-medium text-gray-200">System Status</span>
          <span className="text-xs text-green-400 flex items-center gap-1">
            <span className="block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            All systems operational
          </span>
        </div>
        
        <div className="h-8 w-px bg-gray-700 hidden sm:block"></div>
        
        <div className="flex items-center gap-2 group relative">
          <button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors border border-transparent hover:border-gray-600">
            <User className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:block">{user?.username || 'Admin'}</span>
          </button>
          
          {/* Dropdown Menu on Hover */}
          <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-gray-700/50 transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
