import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { SelectiveReleaseModal } from './SelectiveReleaseModal';

function renderOpen() {
  return render(
    <SelectiveReleaseModal
      project={initialProjects[0]}
      isOpen
      onClose={vi.fn()}
      onConfirmSelectiveRelease={vi.fn()}
    />,
  );
}

test('opens without crashing (Hooks are called before the isOpen check)', () => {
  renderOpen();
  expect(screen.getByText(/選擇性發布至 Production/)).toBeVisible();
});

test('returns null when closed instead of throwing on hook order', () => {
  const { container } = render(
    <SelectiveReleaseModal
      project={initialProjects[0]}
      isOpen={false}
      onClose={vi.fn()}
      onConfirmSelectiveRelease={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('checkbox toggles exactly once per pointer click (no double-toggle from row bubbling)', async () => {
  const user = userEvent.setup();
  renderOpen();
  const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
  const wasChecked = checkbox.checked;
  await user.click(checkbox);
  expect(checkbox.checked).toBe(!wasChecked);
});
