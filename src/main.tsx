import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// V1 runtime entry. The legacy `./App.tsx` stays in the repository, unchanged and deliberately NOT mounted: mounting it
// would start its saved-state PUT effect. Reinstating it must be a separate, reviewed decision.
import ReadOnlyCommandCenter from './v1/ReadOnlyCommandCenter.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ReadOnlyCommandCenter />
    </ErrorBoundary>
  </StrictMode>,
);
