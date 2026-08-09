import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BrowserRouter } from 'react-router-dom';
import { DataProvider } from './contexts/DataContext';
import { AuthProvider } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from './components/ErrorBoundary';

// Outside the router and the providers on purpose: an error thrown while a context is
// initialising has to be caught by something that is not itself inside that context.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="the application">
      <BrowserRouter>
        <AuthProvider>
          <DataProvider>
            <ConfirmProvider>
              <Toaster position="top-right" />
              <App />
            </ConfirmProvider>
          </DataProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
