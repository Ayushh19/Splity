import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { forwardOAuthReturn } from './lib/oauth-return';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

if (!forwardOAuthReturn()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
