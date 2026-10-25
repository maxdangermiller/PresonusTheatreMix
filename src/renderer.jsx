import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter as Router, Routes, Route } from "react-router";

import './index.css';

import App from './components/App';
import { apply_theme } from './components/utils/colors.jsx';
import { BUILTIN_THEMES, resolve_theme } from './utils/themes.js';
import Settings from './components/Settings';
import ActiveCueInfo from './components/ActiveCueInfo';


// Theme engine: start with the default theme's colors (so nothing renders uncolored), then the
// chosen one, and repaint whenever it's changed (Settings, View → Theme)
apply_theme({colors: resolve_theme(BUILTIN_THEMES[0])});
window.themeApi?.get().then(apply_theme);
window.themeApi?.onChange(apply_theme);

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/popup/" element={<Settings/>} />
        <Route path="/active-cue/" element={<ActiveCueInfo/>} />
      </Routes>
    </Router>
  </React.StrictMode>
);