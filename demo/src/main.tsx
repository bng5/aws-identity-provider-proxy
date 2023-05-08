import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';

import App from './App.tsx';
// import './index.css';
import awsExports from './aws-exports.ts';

const redirectSignInOptions = awsExports.oauth.redirectSignIn.split(',');
const redirect = import.meta.env.PROD
   ? redirectSignInOptions.find(s => s.startsWith('https'))
   : redirectSignInOptions.find(s => s.includes('localhost'));

Amplify.configure({
  ...awsExports,
  oauth: {
    ...awsExports.oauth,
    redirectSignIn: redirect,
    redirectSignOut: redirect,
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
