import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

window.onerror = function (message, source, lineno, colno, error) {
  alert('ERROR: ' + message + '\n' + (error && error.stack ? error.stack : ''));
};
window.addEventListener('unhandledrejection', function (event) {
  alert('PROMISE ERROR: ' + (event.reason && event.reason.message ? event.reason.message : event.reason));
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
