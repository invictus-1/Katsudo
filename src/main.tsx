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
import '@fontsource/shippori-mincho/latin-800.css';
import '@fontsource/shippori-mincho/latin-ext-800.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-ext-700.css';
import '@fontsource/special-elite/latin-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dela-gothic-one/latin-ext-400.css';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/bangers/latin-ext-400.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import '@fontsource/antonio/latin-700.css';
import '@fontsource/antonio/latin-ext-700.css';
import '@fontsource/major-mono-display/latin-400.css';
import '@fontsource/major-mono-display/latin-ext-400.css';
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
