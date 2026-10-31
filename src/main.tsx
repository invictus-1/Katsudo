import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// Era faces. Bundled locally; a face's file only loads when its era is on screen.
import '@fontsource/vt323/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/orbitron/700.css';
import './fonts/kanji/kanji.css';
import './ds/tokens.css';
import './ds/katsudo.css';
import './app.css';
import './themes/themes.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
