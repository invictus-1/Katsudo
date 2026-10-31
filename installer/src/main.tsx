import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/vt323/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/orbitron/700.css';
import '../../src/ds/tokens.css';
import '../../src/ds/katsudo.css';
import '../../src/themes/themes.css';
import './setup.css';
import { Setup } from './Setup';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Setup />
  </React.StrictMode>,
);
