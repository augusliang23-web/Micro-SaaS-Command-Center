import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('renders a persistent Simulated / Prototype boundary banner', () => {
  render(<App />);
  expect(screen.getByText(/Simulated \/ Prototype/)).toBeVisible();
});

test('dashboard never claims a live GitHub App sync for the whole workflow', () => {
  render(<App />);
  expect(screen.queryByText(/GitHub App Live/i)).not.toBeInTheDocument();
});
