import React, { useState, useEffect } from 'react';
import { User } from '../types/types';
import { Settings, Link as LinkIcon, Unlink, Save, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  currentUser: User;
}

export default function Integrations({ currentUser }: Props) {
  const [isConnected, setIsConnected] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [workspaceGid, setWorkspaceGid] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    // Load from local storage on mount (mocking backend settings)
    const storedToken = localStorage.getItem('ASANA_ACCESS_TOKEN');
    const storedGid = localStorage.getItem('ASANA_WORKSPACE_GID');
    
    if (storedToken && storedGid) {
      setAccessToken(storedToken);
      setWorkspaceGid(storedGid);
      setIsConnected(true);
    }
  }, []);

  const handleConnect = () => {
    setIsSaving(true);
    setStatusMessage(null);
    
    // Simulate API call to validate credentials
    setTimeout(() => {
      if (accessToken && workspaceGid) {
        localStorage.setItem('ASANA_ACCESS_TOKEN', accessToken);
        localStorage.setItem('ASANA_WORKSPACE_GID', workspaceGid);
        setIsConnected(true);
        setStatusMessage({ type: 'success', text: 'Successfully connected to Asana!' });
      } else {
        setStatusMessage({ type: 'error', text: 'Please provide both an Access Token and Workspace GID.' });
      }
      setIsSaving(false);
    }, 1000);
  };

  const handleDisconnect = () => {
    if (confirm('Are you sure you want to disconnect from Asana? Automated syncing will stop.')) {
      localStorage.removeItem('ASANA_ACCESS_TOKEN');
      localStorage.removeItem('ASANA_WORKSPACE_GID');
      setAccessToken('');
      setWorkspaceGid('');
      setIsConnected(false);
      setStatusMessage({ type: 'success', text: 'Disconnected from Asana.' });
    }
  };

  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
        <p className="text-gray-500 mt-2">Only administrators can manage integrations.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-blue-100 rounded-lg">
          <Settings className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="text-gray-500 text-sm">Manage third-party connections and sync settings.</p>
        </div>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${
          statusMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500" />
          )}
          <p className="text-sm font-medium">{statusMessage.text}</p>
        </div>
      )}

      {/* Asana Integration Card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center shadow-sm">
              <svg viewBox="0 0 426.7 426.7" className="w-7 h-7" fill="#F06A6A">
                <path d="M304 153.9c-24.8 0-45 20.2-45 45s20.2 45 45 45 45-20.2 45-45-20.2-45-45-45zM213.3 53.3c-24.8 0-45 20.2-45 45s20.2 45 45 45 45-20.2 45-45-20.2-45-45-45zM122.7 153.9c-24.8 0-45 20.2-45 45s20.2 45 45 45 45-20.2 45-45-20.2-45-45-45zM213.3 227.8c-24.8 0-45 20.2-45 45s20.2 45 45 45 45-20.2 45-45-20.2-45-45-45z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Asana</h2>
              <p className="text-sm text-gray-500 flex items-center gap-2">
                Task and project management 
                {isConnected && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                    Connected
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div>
            {isConnected ? (
              <button 
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
              >
                <Unlink className="w-4 h-4" />
                Disconnect
              </button>
            ) : (
              <span className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-400 bg-gray-50 rounded-lg text-sm font-medium">
                <Unlink className="w-4 h-4" />
                Not Connected
              </span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 mb-6">
            Connect your Asana workspace to automatically sync tasks, team allocations, and project timelines directly into PM Web. 
            This enables automated workload calculation without dual data entry.
          </p>

          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Personal Access Token (PAT)
              </label>
              <input 
                type="password"
                placeholder="1/1234567890:..."
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                readOnly={isConnected}
                className={`w-full px-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                  isConnected ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-gray-300'
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Generate this in your Asana Developer console. Treat this token like a password.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Workspace GID
              </label>
              <input 
                type="text"
                placeholder="123456789012345"
                value={workspaceGid}
                onChange={(e) => setWorkspaceGid(e.target.value)}
                readOnly={isConnected}
                className={`w-full px-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                  isConnected ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-gray-300'
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                The global ID of your Asana workspace.
              </p>
            </div>
            
            {!isConnected && (
              <div className="pt-4">
                <button 
                  onClick={handleConnect}
                  disabled={isSaving || !accessToken || !workspaceGid}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <LinkIcon className="w-4 h-4" />
                  )}
                  {isSaving ? 'Connecting...' : 'Connect to Asana'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
